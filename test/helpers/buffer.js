const assert = require('assert')

module.exports =
class Buffer {
  constructor (text, {didSetText} = {}) {
    this.text = text
    this.textEqualityResolvers = new Map()
    this.didSetText = didSetText
  }

  getText () {
    return this.text
  }

  setText (text) {
    this.text = text
    if (this.didSetText) this.didSetText(text)
  }

  applyMany (operations) {
    assert(Array.isArray(operations))

    for (let i = operations.length - 1; i >= 0; i--) {
      this.apply(operations[i])
    }
  }

  apply (operation) {
    const oldExtent = traversal(operation.oldEnd, operation.oldStart)
    this.delete(operation.oldStart, oldExtent)

    this.insert(operation.newStart, operation.newText)
  }

  insert (position, text) {
    const index = characterIndexForPosition(this.text, position)
    this.text = this.text.slice(0, index) + text + this.text.slice(index)
    this.resolveOnTextEquality()
    return {type: 'insert', position, text}
  }

  delete (startPosition, extent) {
    const endPosition = traverse(startPosition, extent)
    const textExtent = extentForText(this.text)
    assert(compare(startPosition, textExtent) < 0)
    assert(compare(endPosition, textExtent) <= 0)
    const startIndex = characterIndexForPosition(this.text, startPosition)
    const endIndex = characterIndexForPosition(this.text, endPosition)
    this.text = this.text.slice(0, startIndex) + this.text.slice(endIndex)
    this.resolveOnTextEquality()
    return {type: 'delete', position: startPosition, extent}
  }

  resolveOnTextEquality () {
    const resolvers = this.textEqualityResolvers.get(this.text) || []
    for (const resolve of resolvers) {
      resolve()
    }
    this.textEqualityResolvers.delete(this.text)
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
