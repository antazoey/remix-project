
import React, {useState} from 'react' // eslint-disable-line
import { ViewPlugin } from '@remixproject/engine-web'
import { PluginViewWrapper } from '@remix-ui/helper'
import { RemixAppManager } from '../../remixAppManager'
import { RemixUIGridView } from '@remix-ui/remix-ui-grid-view'
import { RemixUIGridSection } from '@remix-ui/remix-ui-grid-section'
import { RemixUIGridCell } from '@remix-ui/remix-ui-grid-cell'
import * as Data from './remixGuideData.json'
import './remixGuide.css'
//@ts-ignore
const _paq = (window._paq = window._paq || [])

const profile = {
  name: 'remixGuide',
  displayName: 'Remix Guide',
  description: 'Learn remix with videos',
  location: 'mainPanel',
  maintainedBy: 'remix',
  events: []
}

export class RemixGuidePlugin extends ViewPlugin {
  dispatch: React.Dispatch<any> = () => { }
  appManager: RemixAppManager
  element: HTMLDivElement
  payload: any
  showVideo: boolean
  videoID: string
  handleKeyDown: any
  handleEscape: any

  constructor(appManager: RemixAppManager) {
    super(profile)
    this.appManager = appManager
    this.element = document.createElement('div')
    this.element.setAttribute('id', 'remixGuideEl')
    this.payload = {
      sectionToExpandedCell: [['', '']],
      data: {}
    }
  }

  async onActivation() {
    this.handleThemeChange()
    await this.call('tabs', 'focus', 'remixGuide')
    this.renderComponent()
    _paq.push(['trackEvent', 'plugin', 'activated', 'remixGuide'])
    // Read the data
    this.payload.data = Data
    this.handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        this.showVideo = false
        this.renderComponent()
      }
    }
    document.addEventListener('keydown', this.handleKeyDown);
  }

  onDeactivation(): void {
    document.removeEventListener('keydown', this.handleKeyDown);
  }

  private handleThemeChange() {
    this.on('theme', 'themeChanged', (theme: any) => {
      this.renderComponent()
    })
  }

  setDispatch(dispatch: React.Dispatch<any>): void {
    this.dispatch = dispatch
    this.renderComponent()
  }

  render() {
    return (
      <div className="bg-dark" id="remixGuide">
        <PluginViewWrapper plugin={this} />
      </div>
    )
  }

  renderComponent() {
    this.dispatch({
      ...this,
      ...this.payload,
      showVideo: this.showVideo,
      videoID: this.videoID
    })
  }

  updateComponent(state: any) {
    return (
      <div className='d-flex'>
        <RemixUIGridView
          plugin={this}
          styleList={""}
          logo='assets/img/YouTubeLogo.webp'
          enableFilter={true}
          showUntagged={true}
          showPin={false}
          tagList={[
            ['Remix', 'primary'],
            ['Beginner', 'danger'],
            ['Advanced', 'warning'],
            ['AI', 'success'],
            ['Plugins', 'secondary'],
            ['Solidity', 'primary'],
            ['EVM', 'secondary']
          ]}
          title={Data.title}
          description={Data.description}
        >
          { Data.sections.map(section => {
            return <RemixUIGridSection
              plugin={this}
              title={section.title}
              hScrollable= {true}
            >
              { section.cells.map(cell => {
                return <RemixUIGridCell
                  plugin={this}
                  title={cell.title}
                  titleTooltip={cell.titleTooltip}
                  tagList={cell.tagList}
                  classList='RGCellStyle'
                  expandViewEl={
                    cell.expandViewElement
                  }
                  key={cell.title}
                  id={cell.title}
                  handleExpand={() => {
                    this.showVideo = true
                    this.videoID = cell.expandViewElement.videoID
                    this.renderComponent()
                    _paq.push(['trackEvent', 'remixGuide', 'playGuide', cell.title])
                  }}
                >
                  <img
                    src={"//img.youtube.com/vi/" + cell.expandViewElement.videoID + "/0.jpg"}
                    style={{ height: '100px', width: 'fit-content', cursor: 'pointer' }}
                  ></img>
                </RemixUIGridCell>
              })}
            </RemixUIGridSection>
          })}
        </RemixUIGridView>
        { state.showVideo && <div
          data-id={`EnterModalDialogContainer-react`}
          data-backdrop="static"
          data-keyboard="false"
          className={"modal d-flex"}
          role="dialog"
          style={{ justifyContent: "center" }}
        >
          <div className="align-self-center pb-4" role="document">
            <div
              tabIndex={-1}
              className={'modal-content remixModalContent mb-4'}
            >
              <div className="text-break remixModalBody d-flex flex-column p-3 justify-content-between" data-id={`EnterModalDialogModalBody-react`}>
                <iframe style={{ minHeight: "500px", minWidth: "1000px" }} width="1000" height="500" src={"https://www.youtube.com/embed/" + this.videoID + "?si=ZdckOaSPR7VsLj_2"} allowFullScreen></iframe>
              </div>
              <div className="modal-footer d-flex flex-column">
                <button className="btn btn-secondary" onClick={() => {
                  this.showVideo = false
                  this.renderComponent()
                }}>Close</button>
              </div>
            </div>
          </div>
        </div>}
      </div>
    )
  }

}
