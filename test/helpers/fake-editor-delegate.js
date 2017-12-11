const assert = require('assert')

module.exports =
class Editor {
  constructor () {
    this.selectionsBySiteId = {}
  }

  dispose () {
    this.disposed = true
  }

  isDisposed () {
    return this.disposed
  }

  updateViewport (startRow, endRow) {
    this.viewport = {startRow, endRow}
  }

  isScrollNeededToViewPosition (position) {
    assert(position && position.row != null && position.column != null)

    if (this.viewport) {
      const {row} = position
      return row < this.viewport.startRow || row > this.viewport.endRow
    } else {
      return false
    }
  }

  getSelectionsForSiteId (siteId) {
    assert.equal(typeof siteId, 'number', 'siteId must be a number!')
    return this.selectionsBySiteId[siteId]
  }

  updateSelectionsForSiteId (siteId, selectionUpdates) {
    assert.equal(typeof siteId, 'number', 'siteId must be a number!')

    let selectionsForSite = this.selectionsBySiteId[siteId]
    if (!selectionsForSite) {
      selectionsForSite = {}
      this.selectionsBySiteId[siteId] = selectionsForSite
    }

    for (const selectionId in selectionUpdates) {
      const selectionUpdate = selectionUpdates[selectionId]
      if (selectionUpdate) {
        selectionsForSite[selectionId] = selectionUpdate
      } else {
        delete selectionsForSite[selectionId]
      }
    }
  }

  clearSelectionsForSiteId (siteId) {
    delete this.selectionsBySiteId[siteId]
  }
}
