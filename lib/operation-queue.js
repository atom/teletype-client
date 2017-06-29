module.exports =
class OperationQueue {
  constructor () {
    this.queue = []
    this.looping = false
  }

  peek () {
    return this.queue[this.queue.length - 1]
  }

  push ({id, data, fn}) {
    return new Promise((resolve, reject) => {
      this.queue.push({id, data, fn, resolve, reject})
      this.loop()
    })
  }

  // Private
  async loop () {
    if (this.looping) return;

    this.looping = true
    while (this.queue.length > 0) {
      const {id, data, fn, resolve, reject} = this.queue.shift()
      try {
        resolve(await fn(data))
      } catch (e) {
        reject(e)
      }
    }
    this.looping = false
  }

  dispose () {
    this.queue.length = 0
  }
}
