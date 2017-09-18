const assert = require('assert')

module.exports =
class Buffer {
  constructor (text, {didSetText} = {}) {
    this.text = text
    this.didSetText = didSetText
  }

  dispose () {
    this.disposed = true
  }

  isDisposed () {
    return this.disposed
  }

  getText () {
    return this.text
  }

  setText (text) {
    this.text = text
    if (this.didSetText) this.didSetText(text)
  }

  updateText (textUpdates) {
    assert(Array.isArray(textUpdates))

    for (let i = textUpdates.length - 1; i >= 0; i--) {
      const textUpdate = textUpdates[i]
      const oldExtent = traversal(textUpdate.oldEnd, textUpdate.oldStart)
      this.delete(textUpdate.oldStart, oldExtent)
      this.insert(textUpdate.newStart, textUpdate.newText)
    }
  }

  insert (position, text) {
    const index = characterIndexForPosition(this.text, position)
    this.text = this.text.slice(0, index) + text + this.text.slice(index)
    return [position, position, text]
  }

  delete (startPosition, extent) {
    const endPosition = traverse(startPosition, extent)
    const textExtent = extentForText(this.text)
    assert(compare(startPosition, textExtent) < 0)
    assert(compare(endPosition, textExtent) <= 0)
    const startIndex = characterIndexForPosition(this.text, startPosition)
    const endIndex = characterIndexForPosition(this.text, endPosition)
    this.text = this.text.slice(0, startIndex) + this.text.slice(endIndex)
    return [startPosition, endPosition, '']
  }
}

function compare (a, b) {
  if (a.row === b.row) {
    return a.column - b.column
  } else {
    return a.row - b.row
  }
}

function traverse (start, distance) {
  if (distance.row === 0)
    return {row: start.row, column: start.column + distance.column}
  else {
    return {row: start.row + distance.row, column: distance.column}
  }
}

function traversal (end, start) {
  if (end.row === start.row) {
    return {row: 0, column: end.column - start.column}
  } else {
    return {row: end.row - start.row, column: end.column}
  }
}

function extentForText (text) {
  let row = 0
  let column = 0
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (char === '\n') {
      column = 0
      row++
    } else {
      column++
    }
    index++
  }

  return {row, column}
}

function characterIndexForPosition (text, target) {
  const position = {row: 0, column: 0}
  let index = 0
  while (compare(position, target) < 0 && index < text.length) {
    if (text[index] === '\n') {
      position.row++
      position.column = 0
    } else {
      position.column++
    }

    index++
  }

  return index
}
