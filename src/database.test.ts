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

jest.mock('mongoose', () => ({
  connection: {
    // tslint:disable-next-line no-empty
    on: jest.fn()
  },
  connect: () => Promise.reject(),
  // tslint:disable-next-line no-empty
  disconnect: () => {}
}))

import * as mongoose from 'mongoose'
import { connect, disconnect } from '@countryconfig/database'
import { logger } from '@countryconfig/logger'

const wait = (time: number) => new Promise(resolve => setTimeout(resolve, time))

describe('Database connector', () => {
  it('keeps on retrying a connection on startup', async () => {
    const spy = jest.spyOn(logger, 'error')
    const promise = connect()
    await wait(1)
    expect(spy).toHaveBeenCalled()
    jest.spyOn(mongoose, 'connect').mockResolvedValueOnce(mongoose)
    await promise
  })
  it('attaches loggers to database events', async () => {
    const spy = jest.spyOn(logger, 'info')
    const [[, disconnectFn], [, connectedFn]] = (mongoose.connection
      .on as any).mock.calls
    disconnectFn()
    connectedFn()
    expect(spy).toHaveBeenCalledTimes(2)
  })
  it('calls mongoose disconnect when stop method is called', async () => {
    const spy = jest.spyOn(mongoose, 'disconnect')
    await disconnect()
    expect(spy).toHaveBeenCalled()
  })
})
