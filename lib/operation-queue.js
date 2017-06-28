module.exports =
class OperationQueue {
  constructor () {
    this.queue = []
  }

  peek () {
    this.queue[this.queue.length - 1]
  }

  push ({id, data, fn}) {
    return new Promise((resolve, reject) => {
      this.queue.push({id, data, fn, resolve, reject})
      if (this.queue.length === 1) this.loop()
    })
  }

  // Private
  async loop () {
    while (this.queue.length > 0) {
      const {id, data, fn, resolve, reject} = this.queue[0]
      try {
        resolve(await fn(data))
      } catch (e) {
        reject(e)
      } finally {
        this.queue.shift()
      }
    }
  }
}
