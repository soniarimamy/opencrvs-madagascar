import { sumBy, uniq } from 'lodash'
import { join } from 'path'
import { readCSVToJSON } from '../../utils'

type Year = {
  year: number
  male_population: number
  female_population: number
  population: number
  crude_birth_rate: number
}

export type LocationStatistic = {
  statisticalID: string
  years: Year[]
}

type LocationItem = {
  statisticalID: string
  name: string
  partOf: string
  code: string
  physicalType: string
}

export async function getStatisticsForStates() {
  const districts = await readCSVToJSON<LocationItem[]>(
    join(__dirname, './source/districts.csv')
  )
  const states = await readCSVToJSON<LocationItem[]>(
    join(__dirname, './source/states.csv')
  )
  const districtStatistics = await getStatistics()

  const statistics = states.map<LocationStatistic>(state => {
    const districtsInState = districts
      .filter(({ partOf }) => partOf === `Location/${state.statisticalID}`)
      .map(({ statisticalID }) => statisticalID)
    const statsForState = districtStatistics.filter(({ statisticalID }) =>
      districtsInState.includes(statisticalID)
    )

    const allYears = uniq(
      statsForState.flatMap(s => s.years.map(({ year }) => year))
    ).sort()

    return {
      statisticalID: state.statisticalID,
      years: allYears.map(y => {
        const allStatsForThisYear = statsForState.flatMap(s =>
          s.years.filter(({ year }) => year === y)
        )
        return {
          year: y,
          male_population: sumBy(allStatsForThisYear, 'male_population'),
          female_population: sumBy(allStatsForThisYear, 'female_population'),
          population: sumBy(allStatsForThisYear, 'population'),
          crude_birth_rate:
            sumBy(allStatsForThisYear, 'crude_birth_rate') /
            allStatsForThisYear.length
        }
      })
    }
  })

  return statistics
}

export async function getStatistics() {
  const data = await readCSVToJSON<
    Array<Record<string, string> & { statisticalID: string }>
  >(join(__dirname, './source/statistics.csv'))

  return data.map<LocationStatistic>(item => {
    const { statisticalID, ...yearKeys } = item
    return {
      statisticalID: statisticalID,
      years: Object.keys(yearKeys)
        .map(key => key.split('_').pop())
        .map(Number)
        .filter((value, index, list) => list.indexOf(value) == index)
        .map(year => ({
          year,
          male_population: parseFloat(yearKeys[`male_population_${year}`]),
          female_population: parseFloat(yearKeys[`female_population_${year}`]),
          population: parseFloat(yearKeys[`population_${year}`]),
          crude_birth_rate: parseFloat(yearKeys[`crude_birth_rate_${year}`])
        }))
    }
  })
}
