import React from 'react'
import { ViewPlugin } from '@remixproject/engine-web'
import { PluginViewWrapper } from '@remix-ui/helper'
import { trackMatomoEvent } from '@remix-api'
import { DomainMigration } from '@remix-ui/domain-migration'
import { RemixAppManager } from '../../remixAppManager'

const profile = {
  name: 'domainMigration',
  displayName: 'Move your projects',
  description: 'Export and import your workspaces and settings when moving between Remix domains',
  location: 'mainPanel',
  methods: ['showMigration'],
  events: []
}

export class DomainMigrationPlugin extends ViewPlugin {
  dispatch: React.Dispatch<any> = () => {}
  appManager: RemixAppManager
  element: HTMLDivElement
  payload: { mode?: 'export' | 'import' }

  constructor(appManager: RemixAppManager) {
    super(profile)
    this.appManager = appManager
    this.element = document.createElement('div')
    this.element.setAttribute('id', 'domainMigration')
    this.payload = {}
  }

  async onActivation() {
    trackMatomoEvent(this, { category: 'plugin', action: 'activated', name: 'domainMigration', isClick: true })
  }

  onDeactivation(): void {}

  async showMigration(mode?: 'export' | 'import') {
    this.payload = { mode }
    await this.call('tabs', 'focus', 'domainMigration')
    this.renderComponent()
  }

  setDispatch(dispatch: React.Dispatch<any>): void {
    this.dispatch = dispatch
    this.renderComponent()
  }

  render() {
    return (
      <div id="domainMigration" className="h-100">
        <PluginViewWrapper plugin={this} />
      </div>
    )
  }

  renderComponent() {
    this.dispatch({ ...this, ...this.payload })
  }

  updateComponent(state: any) {
    return <DomainMigration plugin={this} targetOrigin={state?.targetOrigin} />
  }
}
