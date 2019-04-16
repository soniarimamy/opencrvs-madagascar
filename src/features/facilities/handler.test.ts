import { readFileSync } from 'fs'
import * as jwt from 'jsonwebtoken'
import { createServer } from '../..'
import * as facilitiesService from 'src/features/facilities/service/service'
import { ILocationDataResponse } from './service/service'

describe('facilities handler receives a request', () => {
  let server: any

  beforeEach(async () => {
    server = await createServer()
  })

  describe('service returns facilities json to client', () => {
    const mockReturn: ILocationDataResponse = {
      data: [
        {
          id: '3fadd4e1-bcfd-470b-a997-07bc09631e2c',
          name: 'Moktarpur Union Parishad',
          nameBn: 'মোক্তারপুর ইউনিয়ন পরিষদ',
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

      const token = jwt.sign({}, readFileSync('../auth/test/cert.key'), {
        algorithm: 'RS256',
        issuer: 'opencrvs:auth-service',
        audience: 'opencrvs:resources-user'
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