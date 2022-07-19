/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * OpenCRVS is also distributed under the terms of the Civil Registration
 * & Healthcare Disclaimer located at http://opencrvs.org/license.
 *
 * Copyright (C) The OpenCRVS Authors. OpenCRVS and the OpenCRVS
 * graphic logo are (registered/a) trademark(s) of Plan International.
 */
import { readFileSync } from 'fs'
import * as jwt from 'jsonwebtoken'
import { createServer } from '@countryconfig/index'
import * as facilitiesService from '@countryconfig/features/facilities/service/service'

describe('facilities handler receives a request', () => {
  let server: any

  beforeEach(async () => {
    server = await createServer()
  })

  describe('service returns facilities json to client', () => {
    const mockReturn: facilitiesService.ILocationDataResponse = {
      data: [
        {
          id: '3fadd4e1-bcfd-470b-a997-07bc09631e2c',
          name: 'Moktarpur Union Parishad',
          alias: 'মোক্তারপুর ইউনিয়ন পরিষদ',
          physicalType: 'Building',
          type: 'CRVS_OFFICE',
          partOf: 'Location/0'
        }
      ]
    }
    it('returns a facilities array', async () => {
      jest
        .spyOn(facilitiesService, 'getFacilities')
        .mockReturnValue(Promise.resolve(mockReturn))

      const token = jwt.sign({}, readFileSync('./test/cert.key'), {
        algorithm: 'RS256',
        issuer: 'opencrvs:auth-service',
        audience: 'opencrvs:countryconfig-user'
      })

      const res = await server.server.inject({
        method: 'GET',
        url: '/facilities',
        headers: {
          Authorization: `Bearer ${token}`
        }
      })
      expect(JSON.parse(res.payload).data[0].id).toBe(
        '3fadd4e1-bcfd-470b-a997-07bc09631e2c'
      )
    })
  })
})
