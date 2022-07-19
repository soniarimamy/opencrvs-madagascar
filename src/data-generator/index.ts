import {
  createBirthDeclaration,
  createDeathDeclaration,
  fetchAlreadyGeneratedInterval,
  fetchDeathRegistration,
  fetchRegistration,
  sendBirthNotification
} from './declare'
import {
  createRegistrationDetails,
  createBirthRegistrationDetailsForNotification,
  markAsRegistered,
  markDeathAsRegistered
} from './register'
import {
  createBirthCertificationDetails,
  createDeathCertificationDetails,
  markAsCertified,
  markDeathAsCertified
} from './certify'

import {
  getDayOfYear,
  getDaysInYear,
  startOfYear,
  setYear,
  addDays,
  differenceInDays,
  sub,
  add,
  startOfDay,
  isWithinInterval,
  endOfYear,
  endOfDay,
  min
} from 'date-fns'

import { getToken, readToken, updateToken } from './auth'
import { getRandomFromBrackets, log } from './util'
import { getLocations, getFacilities, Location, Facility } from './location'

import { getLocationMetrics } from './statistics'
import { User, createUsers } from './users'
import PQueue from 'p-queue'
import { BirthRegistrationInput } from './gateway'
import { ConfigResponse, getConfig } from './config'

/*
 *
 * Configuration
 *
 */

// The script is required to log in with a demo system admin
// This prevents the script from being used in production, as there are no users with a "demo" scope there
const USERNAME = 'emmanuel.mayuka'
const PASSWORD = 'test'
export const VERIFICATION_CODE = '000000'

export const FIELD_AGENTS = 5
export const HOSPITAL_FIELD_AGENTS = 7
export const REGISTRATION_AGENTS = 2
export const LOCAL_REGISTRARS = 1

const CONCURRENCY = process.env.CONCURRENCY
  ? parseInt(process.env.CONCURRENCY, 10)
  : 3

const DISTRICTS = process.env.DISTRICTS
  ? process.env.DISTRICTS.split(',')
  : null

const START_YEAR = 2021
const END_YEAR = 2022

const REGISTER = process.env.REGISTER !== 'false'
const CERTIFY = process.env.CERTIFY !== 'false'

const BIRTH_OVERALL_REGISTRATIONS_COMPARED_TO_ESTIMATE = 0.8
const DEATH_OVERALL_REGISTRATIONS_COMPARED_TO_ESTIMATE = 0.4

const today = new Date()
const currentYear = today.getFullYear()

const queue = new PQueue({ concurrency: CONCURRENCY, timeout: 1000 * 60 })

let pauseTimeout: NodeJS.Timeout
function onError(error: Error) {
  console.error(error)
  clearTimeout(pauseTimeout)

  if (!queue.isPaused) {
    log('Stopping queue')
    queue.pause()
  } else {
    log('Extending queue stop for 30 more seconds')
  }

  pauseTimeout = setTimeout(() => {
    log('Queue starting up again')
    queue.start()
  }, 30000)
}

async function keepTokensValid(users: User[]) {
  users.forEach(user => {
    const data = readToken(user.token)
    setTimeout(() => updateToken(user), data.exp * 1000 - Date.now() - 60000)
  })
}

function wait(time: number) {
  return new Promise(resolve => setTimeout(resolve, time))
}

async function main() {
  log('Fetching token for system administrator')
  const token = await getToken(USERNAME, PASSWORD)
  console.log('Got token for system administrator')
  const config = await getConfig(token)

  const BIRTH_COMPLETION_DISTRIBUTION = [
    { range: [0, config.config.BIRTH.REGISTRATION_TARGET], weight: 0.8 },
    {
      range: [
        config.config.BIRTH.REGISTRATION_TARGET,
        config.config.BIRTH.LATE_REGISTRATION_TARGET
      ],
      weight: 0.15
    },
    {
      range: [config.config.BIRTH.LATE_REGISTRATION_TARGET, 365 * 5],
      weight: 0.025
    },
    { range: [365 * 5 + 1, 365 * 20], weight: 0.025 }
  ]

  const DEATH_COMPLETION_DISTRIBUTION = [
    { range: [0, config.config.DEATH.REGISTRATION_TARGET], weight: 0.75 },
    {
      range: [config.config.DEATH.REGISTRATION_TARGET, 365],
      weight: 0.125
    },
    { range: [366, 365 * 5], weight: 0.125 }
  ]

  log('Got token for system administrator')
  log('Fetching locations')
  const locations = DISTRICTS
    ? (await getLocations(token)).filter(location =>
        DISTRICTS.includes(location.id)
      )
    : await getLocations(token)

  const facilities = await getFacilities(token)
  const crvsOffices = facilities.filter(({ type }) => type === 'CRVS_OFFICE')
  const healthFacilities = facilities.filter(
    ({ type }) => type === 'HEALTH_FACILITY'
  )

  log('Found', locations.length, 'locations')

  /*
   *
   * Loop through all locations
   *
   */

  for (const location of locations) {
    log('Fetching already generated interval')
    const generatedInterval = await fetchAlreadyGeneratedInterval(
      token,
      crvsOffices
        .filter(({ partOf }) => partOf === `Location/${location.id}`)
        .map(({ id }) => id)
    )

    if (generatedInterval.length === 0) {
      log('No events have been generated for this location')
    } else {
      log(
        'Events already exist for this location between',
        generatedInterval[0],
        '-',
        generatedInterval[1]
      )
    }

    /*
     *
     * Create required users & authorization tokens
     *
     */
    log('Creating users for', location.name, '(', location.id, ')')

    const users = await createUsers(token, location, {
      fieldAgents: FIELD_AGENTS,
      hospitalFieldAgents: HOSPITAL_FIELD_AGENTS,
      registrationAgents: REGISTRATION_AGENTS,
      localRegistrars: LOCAL_REGISTRARS
    })
    const allUsers = [
      ...users.fieldAgents,
      ...users.hospitals,
      ...users.registrationAgents,
      ...users.registrars
    ]

    // User tokens expire after 20 minutes, so we need to
    // keep on refreshing them as long as the user is in use
    keepTokensValid(allUsers)

    const deathDeclarers = [...users.fieldAgents, ...users.registrationAgents]
    const birthDeclararers = [
      ...users.fieldAgents,
      ...users.hospitals,
      ...users.registrationAgents
    ]

    /*
     *
     * Loop through years (END_YEAR -> START_YEAR)
     *
     */

    for (let y = END_YEAR; y >= START_YEAR; y--) {
      const isCurrentYear = y === currentYear

      const randomRegistrar =
        users.registrars[Math.floor(Math.random() * users.registrars.length)]

      const days = Array.from({ length: getDaysInYear(y) }).map(() => 0)
      let { birthRates, totalDeathsThisYear } = await getEstimates(
        randomRegistrar,
        y,
        location,
        isCurrentYear,
        days
      )

      if (isCurrentYear) {
        const currentDayNumber = getDayOfYear(today)
        // Remove future dates from the arrays
        days.splice(currentDayNumber - 1)
      }

      log('Creating declarations for', location.name, 'estimates', {
        births: birthRates,
        death: totalDeathsThisYear
      })

      birthRates.female =
        birthRates.female * BIRTH_OVERALL_REGISTRATIONS_COMPARED_TO_ESTIMATE
      birthRates.male =
        birthRates.male * BIRTH_OVERALL_REGISTRATIONS_COMPARED_TO_ESTIMATE

      totalDeathsThisYear =
        totalDeathsThisYear * DEATH_OVERALL_REGISTRATIONS_COMPARED_TO_ESTIMATE

      const femalesPerDay = days.slice(0)
      const malesPerDay = days.slice(0)
      const deathsPerDay = days.slice(0)

      for (let i = 0; i < birthRates.female; i++) {
        femalesPerDay[Math.floor(Math.random() * days.length)]++
      }
      for (let i = 0; i < birthRates.male; i++) {
        malesPerDay[Math.floor(Math.random() * days.length)]++
      }
      for (let i = 0; i < totalDeathsThisYear; i++) {
        deathsPerDay[Math.floor(Math.random() * days.length)]++
      }
      log('Creating', {
        male: malesPerDay.reduce((a, x) => a + x),
        female: femalesPerDay.reduce((a, x) => a + x),
        death: deathsPerDay.reduce((a, x) => a + x)
      })
      /*
       *
       * Loop through days in the year (last day of the year -> start of the year)
       *
       */

      for (let d = days.length - 1; d >= 0; d--) {
        const submissionDate = addDays(startOfYear(setYear(new Date(), y)), d)

        if (
          generatedInterval.length === 2 &&
          isWithinInterval(submissionDate, {
            start: startOfDay(generatedInterval[0]),
            end: endOfDay(generatedInterval[1])
          })
        ) {
          log('Data for', submissionDate, 'already exists. Skipping.')
          continue
        }

        /*
         *
         * CREATE DEATH DECLARATIONS
         * - Declaring user is chosen randomly from users with declare role
         * -
         */

        const deathsToday = deathsPerDay[d]

        log(
          'Creating death declarations for',
          submissionDate,
          'total:',
          deathsToday
        )

        let operations = []
        for (let ix = 0; ix < deathsToday; ix++) {
          const completionDays = getRandomFromBrackets(
            DEATH_COMPLETION_DISTRIBUTION
          )
          operations.push(
            deathDeclarationWorkflow(
              deathDeclarers,
              submissionDate,
              location,
              deathsToday,
              users,
              healthFacilities,
              completionDays,
              config
            ).bind(null, ix)
          )
        }

        /*
         *
         * CREATE BIRTH DECLARATIONS
         *
         * - Registration day is the one we're currently at in the loop
         * - Birthdate is randomised date in the past based on completion brackets
         * - Gender is randomised based on configured male / female birth rates
         * - Declaring / registering / certifying user is randomised from a pool of users
         *    with the correct role
         */

        log(
          'Creating birth declarations for',
          submissionDate,
          'male:',
          malesPerDay[d],
          'female',
          femalesPerDay[d]
        )

        // Create birth declarations
        const totalChildBirths = malesPerDay[d] + femalesPerDay[d]
        const probabilityForMale = malesPerDay[d] / totalChildBirths

        for (let ix = 0; ix < Math.round(totalChildBirths); ix++) {
          const completionDays = getRandomFromBrackets(
            BIRTH_COMPLETION_DISTRIBUTION
          )
          operations.push(
            birthDeclarationWorkflow(
              birthDeclararers,
              users,
              probabilityForMale,
              submissionDate,
              crvsOffices,
              healthFacilities,
              location,
              totalChildBirths,
              completionDays,
              config
            ).bind(null, ix)
          )
        }
        await queue.addAll(operations)
      }

      /*
       * Ensure target rate numbers match the configured rate numbers
       * This is done because sometimes a number of declarations fail during the generator run
       * which then again causes the target rate numbers to be incorrect
       */

      let operations = []

      const newEstimates = await getEstimates(
        randomRegistrar,
        y,
        location,
        isCurrentYear,
        Array.from({ length: getDaysInYear(y) }).map(() => 0)
      )

      const shouldGenerate =
        (newEstimates.birthRates.male + newEstimates.birthRates.female) *
        BIRTH_OVERALL_REGISTRATIONS_COMPARED_TO_ESTIMATE

      const delta =
        shouldGenerate -
        newEstimates.birthMetrics.results.reduce(
          (acc, cur) => acc + cur.total,
          0
        )

      log('Filling birth declarations', {
        shouldGenerate,
        generated: newEstimates.birthMetrics.results.reduce(
          (acc, cur) => acc + cur.total,
          0
        ),
        delta,
        distribution: Array.from({ length: delta })
          .map(() => getRandomFromBrackets(BIRTH_COMPLETION_DISTRIBUTION))
          .reduce((acc, cur) => {
            BIRTH_COMPLETION_DISTRIBUTION.forEach(d => {
              if (cur >= d.range[0] && cur <= d.range[1]) {
                acc[d.range[0]] = acc[d.range[0]] ? acc[d.range[0]] + 1 : 1
              }
            })
            return acc
          }, {})
      })

      for (let ix = 0; ix < delta; ix++) {
        const randomSubmissionDate = min([
          addDays(
            startOfYear(setYear(new Date(), y)),
            Math.floor(Math.random() * days.length)
          ),
          new Date()
        ])
        const completionDays = getRandomFromBrackets(
          BIRTH_COMPLETION_DISTRIBUTION
        )
        operations.push(
          await birthDeclarationWorkflow(
            birthDeclararers,
            users,
            birthRates.male / (birthRates.male + birthRates.female),
            randomSubmissionDate,
            crvsOffices,
            healthFacilities,
            location,
            delta,
            completionDays,
            config
          ).bind(null, ix)
        )
      }
      await queue.addAll(operations)

      /*
       * Same for death
       */
      const shouldGenerateDeaths =
        newEstimates.totalDeathsThisYear *
        DEATH_OVERALL_REGISTRATIONS_COMPARED_TO_ESTIMATE
      const totalGeneratedDeaths = newEstimates.deathMetrics.results.reduce(
        (acc, cur) => acc + cur.total,
        0
      )
      const deathDelta = shouldGenerateDeaths - totalGeneratedDeaths

      log('Filling death declarations', {
        shouldGenerateDeaths,
        totalGeneratedDeaths,
        deathDelta,
        distribution: Array.from({ length: deathDelta })
          .map(() => getRandomFromBrackets(DEATH_COMPLETION_DISTRIBUTION))
          .reduce((acc, cur) => {
            DEATH_COMPLETION_DISTRIBUTION.forEach(d => {
              if (cur >= d.range[0] && cur <= d.range[1]) {
                acc[d.range[0]] = acc[d.range[0]] ? acc[d.range[0]] + 1 : 1
              }
            })
            return acc
          }, {})
      })

      for (let ix = 0; ix < deathDelta; ix++) {
        const submissionDate = min([
          addDays(
            startOfYear(setYear(new Date(), y)),
            Math.floor(Math.random() * days.length)
          ),
          new Date()
        ])
        const completionDays = getRandomFromBrackets(
          DEATH_COMPLETION_DISTRIBUTION
        )
        operations.push(
          deathDeclarationWorkflow(
            deathDeclarers,
            submissionDate,
            location,
            deathDelta,
            users,
            healthFacilities,
            completionDays,
            config
          ).bind(null, ix)
        )
      }
      await queue.addAll(operations)
    }

    allUsers.forEach(user => {
      user.stillInUse = false
    })
  }

  process.exit(0)

  async function getEstimates(
    randomRegistrar: User,
    y: number,
    location: Location,
    isCurrentYear: boolean,
    days: number[]
  ) {
    let birthMetrics = await getLocationMetrics(
      randomRegistrar.token,
      startOfYear(new Date(y, 1, 1)),
      endOfYear(new Date(y, 1, 1)),
      location.id,
      'BIRTH'
    )
    let deathMetrics = await getLocationMetrics(
      randomRegistrar.token,
      startOfYear(new Date(y, 1, 1)),
      endOfYear(new Date(y, 1, 1)),
      location.id,
      'DEATH'
    )

    let totalDeathsThisYear = deathMetrics.estimated.totalEstimation

    // Calculate crude birth & death rates for this district for both men and women
    const birthRates = {
      male: birthMetrics.estimated.maleEstimation,
      female: birthMetrics.estimated.femaleEstimation
    }

    if (isCurrentYear) {
      // If we're processing the current year, only take into account
      // the days until today
      const currentDayNumber = getDayOfYear(today)

      // Adjust birth rates to the amount of days passed since the start of this year
      birthRates.female = (birthRates.female / days.length) * currentDayNumber
      birthRates.male = (birthRates.male / days.length) * currentDayNumber

      totalDeathsThisYear =
        (totalDeathsThisYear / days.length) * currentDayNumber
    }

    return { birthRates, birthMetrics, totalDeathsThisYear, deathMetrics }
  }
}

main()

function birthDeclarationWorkflow(
  birthDeclararers: User[],
  users: {
    fieldAgents: User[]
    hospitals: User[]
    registrationAgents: User[]
    registrars: User[]
  },
  probabilityForMale: number,
  submissionDate: Date,
  crvsOffices: Facility[],
  healthFacilities: Facility[],
  location: Location,
  totalChildBirths: number,
  completionDays: number,
  config: ConfigResponse
) {
  return async (ix: number) => {
    try {
      const randomUser =
        birthDeclararers[Math.floor(Math.random() * birthDeclararers.length)]

      const randomRegistrar =
        users.registrars[Math.floor(Math.random() * users.registrars.length)]

      const isHospitalUser = users.hospitals.includes(randomUser)

      const sex = Math.random() < probabilityForMale ? 'male' : 'female'
      // This is here so that no creation timestamps would be equal
      // InfluxDB will otherwise interpret the events as the same exact measurement
      const submissionTime = add(startOfDay(submissionDate), {
        seconds: 24 * 60 * 60 * Math.random()
      })

      const birthDate = sub(submissionTime, { days: completionDays })

      const crvsOffice = crvsOffices.find(
        ({ id }) => id === randomUser.primaryOfficeId
      )

      if (!crvsOffice) {
        throw new Error(
          `CRVS office was not found with the id ${randomUser.primaryOfficeId}`
        )
      }

      const districtFacilities = healthFacilities.filter(
        ({ partOf }) => partOf?.split('/')[1] === location.id
      )

      if (districtFacilities.length === 0) {
        throw new Error('Could not find any facilities for location')
      }

      const randomFacility =
        districtFacilities[
          Math.floor(Math.random() * districtFacilities.length)
        ]

      const declaredRecently = differenceInDays(today, submissionTime) < 4

      let id: string
      let registrationDetails: BirthRegistrationInput
      if (isHospitalUser) {
        log('Sending a DHIS2 Hospital notification')

        id = await sendBirthNotification(
          randomUser,
          sex,
          birthDate,
          submissionTime,
          randomFacility
        )
        const declaration = await fetchRegistration(randomRegistrar, id)
        try {
          registrationDetails = await createBirthRegistrationDetailsForNotification(
            add(new Date(submissionTime), {
              days: 1
            }),
            location,
            declaration
          )
        } catch (error) {
          console.log(error)
          console.log(JSON.stringify(declaration))
          throw error
        }
      } else {
        id = await createBirthDeclaration(
          randomUser,
          sex,
          birthDate,
          submissionTime,
          location,
          randomFacility
        )
        const declaration = await fetchRegistration(randomRegistrar, id)
        try {
          registrationDetails = await createRegistrationDetails(
            add(new Date(submissionTime), {
              days: 1
            }),
            declaration
          )
        } catch (error) {
          console.log(error)
          console.log(JSON.stringify(declaration))
          throw error
        }
        log('Registering', id)
      }

      if (!REGISTER) {
        log('Birth', submissionDate, ix, '/', Math.round(totalChildBirths))
        return
      }

      if (!declaredRecently || Math.random() > 0.5) {
        await markAsRegistered(randomRegistrar, id, registrationDetails)
        const registration = await fetchRegistration(randomRegistrar, id)

        if (
          CERTIFY &&
          (!declaredRecently || Math.random() > 0.5) &&
          registration
        ) {
          // Wait for few seconds so registration gets updated to elasticsearch before certifying
          await wait(2000)
          log('Certifying', id)
          await markAsCertified(
            registration.id,
            randomRegistrar,
            createBirthCertificationDetails(
              add(new Date(submissionTime), {
                days: 1
              }),
              registration,
              config
            )
          )
        } else {
          log(
            'Will not register or certify because the declaration was added today'
          )
        }
      }

      log('Birth', submissionDate, ix, '/', Math.round(totalChildBirths))
    } catch (error) {
      onError(error)
    }
  }
}

function deathDeclarationWorkflow(
  deathDeclarers: User[],
  submissionDate: Date,
  location: Location,
  deathsToday: number,
  users: {
    fieldAgents: User[]
    hospitals: User[]
    registrationAgents: User[]
    registrars: User[]
  },
  healthFacilities: Facility[],
  completionDays: number,
  config: ConfigResponse
) {
  return async (ix: number) => {
    try {
      const randomUser =
        deathDeclarers[Math.floor(Math.random() * deathDeclarers.length)]

      const submissionTime = add(startOfDay(submissionDate), {
        seconds: 24 * 60 * 60 * Math.random()
      })
      const declaredRecently = differenceInDays(today, submissionTime) < 4

      const districtFacilities = healthFacilities.filter(
        ({ partOf }) => partOf?.split('/')[1] === location.id
      )

      const randomFacility =
        districtFacilities[
          Math.floor(Math.random() * districtFacilities.length)
        ]
      const deathTime = sub(submissionTime, { days: completionDays })
      log('Declaring')
      const compositionId = await createDeathDeclaration(
        randomUser,
        deathTime,
        Math.random() > 0.4 ? 'male' : 'female',
        submissionTime,
        location,
        randomFacility
      )

      if (!REGISTER) {
        log('Death', submissionDate, ix, '/', deathsToday)
        return
      }

      const randomRegistrar =
        users.registrars[Math.floor(Math.random() * users.registrars.length)]
      log('Registering', { compositionId })

      const declaration = await fetchDeathRegistration(
        randomRegistrar,
        compositionId
      )
      if (!declaredRecently || Math.random() > 0.5) {
        await markDeathAsRegistered(
          randomRegistrar,
          compositionId,
          createRegistrationDetails(
            add(new Date(submissionTime), {
              days: 1
            }),
            declaration
          )
        )
        const registration = await fetchDeathRegistration(
          randomRegistrar,
          compositionId
        )
        log('Certifying', registration.id)
        await wait(2000)
        if (CERTIFY && (!declaredRecently || Math.random() > 0.5)) {
          await markDeathAsCertified(
            registration.id,
            randomRegistrar,
            createDeathCertificationDetails(
              add(new Date(submissionTime), {
                days: 2
              }),
              registration,
              config
            )
          )
        }
      }

      log('Death', submissionDate, ix, '/', deathsToday)
    } catch (error) {
      onError(error)
    }
  }
}
