const assert = require('assert')

module.exports =
class Buffer {
  constructor (text) {
    this.text = text
    this.textEqualityResolvers = new Map()
  }

  getText () {
    return this.text
  }

  whenTextEquals (text) {
    if (text === this.text) {
      return Promise.resolve()
    } else {
      return new Promise((resolve) => {
        let resolvers = this.textEqualityResolvers.get(text)
        if (!resolvers) {
          resolvers = []
          this.textEqualityResolvers.set(text, resolvers)
        }
        resolvers.push(resolve)
      })
    }
  }

  setText (text) {
    this.text = text
  }

  applyMany (operations) {
    assert(Array.isArray(operations))

    for (let i = operations.length - 1; i >= 0; i--) {
      this.apply(operations[i])
    }
  }

  apply (operation) {
    if (operation.type === 'delete') {
      this.delete(operation.position, operation.extent)
    } else if (operation.type === 'insert') {
      this.insert(operation.position, operation.text)
    } else {
      throw new Error('Unknown operation type')
    }
  }

  insert (position, text) {
    this.text = this.text.slice(0, position) + text + this.text.slice(position)
    this.resolveOnTextEquality()
    return {type: 'insert', position, text}
  }

  delete (position, extent) {
    assert(position < this.text.length)
    assert(position + extent <= this.text.length)
    this.text = this.text.slice(0, position) + this.text.slice(position + extent)
    this.resolveOnTextEquality()
    return {type: 'delete', position, extent}
  }

  resolveOnTextEquality () {
    const resolvers = this.textEqualityResolvers.get(this.text) || []
    for (const resolve of resolvers) {
      resolve()
    }
    this.textEqualityResolvers.delete(this.text)
  }
}
