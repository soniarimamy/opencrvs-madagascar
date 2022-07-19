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
/// <reference types="Cypress" />

context('Death Integration Test', () => {
  beforeEach(() => {
    indexedDB.deleteDatabase('OpenCRVS')
  })

  it('Tests registration by registrar using maximum input', () => {
    cy.login('registrar')
    cy.createPin()
    cy.verifyLandingPageVisible()

    cy.enterDeathMaximumInput()
    cy.registerDeclaration()
  })

  it('Tests from declaration to registration using minimum input', () => {
    cy.registerDeathDeclarationWithMinimumInput()
  })

  it('Login as registrar to register minimum input death declaration', () => {
    cy.login('registrar')
    cy.createPin()
    cy.reviewForm()
    cy.submitForm()
  })

  it('Tests from declaration to registration using maximum input', () => {
    cy.registerDeathDeclarationWithMaximumInput()
  })

  it('Login as registrar to register maximum input death declaration', () => {
    cy.login('registrar')
    cy.createPin()
    cy.reviewForm()
    cy.submitForm()
  })

  it('Tests from declaration to rejection using minimum input', () => {
    cy.declareDeathDeclarationWithMinimumInput()
  })

  it('Login As Register & Reject Minimum input Death Declaration', () => {
    cy.login('registrar')
    cy.createPin()
    cy.reviewForm()
    cy.rejectDeclaration()
  })

  it('Tests from declaration to rejection using maximum input', () => {
    cy.declareDeathDeclarationWithMaximumInput()
  })

  it('Login As Register & Reject Maximum input Death Declaration', () => {
    cy.login('registrar')
    cy.createPin()
    cy.reviewForm()
    cy.rejectDeclaration()
  })
})
