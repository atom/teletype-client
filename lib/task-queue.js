const assert = require('assert')

module.exports =
class TaskQueue {
  constructor () {
    this.tasks = []
    this.looping = false
    this.disposed = false
  }

  push (task) {
    assert(!this.disposed, 'Cannot use after dispose')
    this.tasks.push(task)
    if (!this.looping) this.loop()
  }

  cancelPending (id) {
    assert(!this.disposed, 'Cannot use after dispose')
    for (let i = this.tasks.length - 1; i >= 0; i--) {
      const task = this.tasks[i]
      if (task.id === id) this.tasks.splice(i, 1)
    }
  }

  async loop () {
    assert(!this.looping, 'Cannot have simultaneous loops')
    this.looping = true
    while (this.tasks.length > 0) {
      const {id, data, coalesce, execute} = this.tasks.shift()
      const dataToCoalesce = [data]
      while (this.tasks.length > 0 && this.tasks[0].id === id) {
        dataToCoalesce.push(this.tasks[0].data)
        this.tasks.shift()
      }

      await execute(coalesce(dataToCoalesce))
    }
    this.looping = false
  }

  dispose () {
    this.tasks.length = 0
    this.disposed = true
  }

  isLooping () {
    return this.looping
  }
}
