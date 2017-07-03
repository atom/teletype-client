const assert = require('assert')
const deepEqual = require('deep-equal')
const TaskQueue = require('../lib/task-queue')

suite('TaskQueue', () => {
  test('in-order execution', async () => {
    const queue = new TaskQueue()
    const executedTasks = []

    let resolveTask1Promise
    queue.push({
      id: 'task-1',
      data: 'a',
      coalesce: (d) => d,
      execute: (d) => {
        executedTasks.push('task-1')
        return new Promise((resolve) => resolveTask1Promise = resolve)
      }
    })
    assert.deepEqual(executedTasks, ['task-1'])

    let resolveTask2Promise
    queue.push({
      id: 'task-2',
      data: 'b',
      coalesce: (d) => d,
      execute: (d) => {
        executedTasks.push('task-2')
        return new Promise((resolve) => resolveTask2Promise = resolve)
      }
    })
    assert.deepEqual(executedTasks, ['task-1'])

    let resolveTask3Promise
    queue.push({
      id: 'task-3',
      data: 'c',
      coalesce: (d) => d,
      execute: (d) => {
        executedTasks.push('task-3')
        return new Promise((resolve) => resolveTask3Promise = resolve)
      }
    })
    assert.deepEqual(executedTasks, ['task-1'])

    resolveTask1Promise()
    await condition(() => deepEqual(executedTasks, ['task-1', 'task-2']))

    resolveTask2Promise()
    await condition(() => deepEqual(executedTasks, ['task-1', 'task-2', 'task-3']))

    resolveTask3Promise()
    await condition(() => !queue.isLooping())

    let resolveTask4Promise
    queue.push({
      id: 'task-4',
      data: 'e',
      coalesce: (d) => d,
      execute: (d) => {
        executedTasks.push('task-4')
        return new Promise((resolve) => resolveTask4Promise = resolve)
      }
    })
    assert.deepEqual(executedTasks, ['task-1', 'task-2', 'task-3', 'task-4'])

    resolveTask4Promise()
    await condition(() => !queue.isLooping())
  })

  test('coalescing', async () => {
    const queue = new TaskQueue()
    const executedTasks = []

    let resolveTask1Promise1
    const task1Promise1 = new Promise((resolve) => resolveTask1Promise1 = resolve)
    queue.push({
      id: 'task-1',
      data: 'a',
      coalesce: (data) => data.reduce((a, b) => a + b),
      execute: (data) => {
        executedTasks.push({id: 'task-1', data})
        return task1Promise1
      }
    })

    let resolveTask1Promise2
    const task1Promise2 = new Promise((resolve) => resolveTask1Promise2 = resolve)
    queue.push({
      id: 'task-1',
      data: 'b',
      coalesce: (data) => data.reduce((a, b) => a + b),
      execute: (data) => {
        executedTasks.push({id: 'task-1', data})
        return task1Promise2
      }
    })

    let resolveTask1Promise3
    const task1Promise3 = new Promise((resolve) => resolveTask1Promise3 = resolve)
    queue.push({
      id: 'task-1',
      data: 'c',
      coalesce: (data) => data.reduce((a, b) => a + b),
      execute: (data) => {
        executedTasks.push({id: 'task-1', data})
        return task1Promise3
      }
    })

    let resolveTask2Promise1
    const task2Promise1 = new Promise((resolve) => resolveTask2Promise1 = resolve)
    queue.push({
      id: 'task-2',
      data: 'd',
      coalesce: (data) => data.reduce((a, b) => a + b),
      execute: (data) => {
        executedTasks.push({id: 'task-2', data})
        return task2Promise1
      }
    })

    let resolveTask2Promise2
    const task2Promise2 = new Promise((resolve) => resolveTask2Promise2 = resolve)
    queue.push({
      id: 'task-2',
      data: 'e',
      coalesce: (data) => data.reduce((a, b) => a + b),
      execute: (data) => {
        executedTasks.push({id: 'task-2', data})
        return task2Promise2
      }
    })

    resolveTask1Promise1()
    await task1Promise1
    resolveTask1Promise2()
    await task1Promise2
    resolveTask1Promise3()
    await task1Promise3
    resolveTask2Promise1()
    await task2Promise1
    resolveTask2Promise2()
    await task2Promise2

    assert.deepEqual(
      executedTasks,
      [{id: 'task-1', data: 'a'}, {id: 'task-1', data: 'bc'}, {id: 'task-2', data: 'de'}]
    )
  })

  test('pending task cancellation', async () => {
    const queue = new TaskQueue()
    const executedTasks = []

    let resolveTask1Promise
    const task1Promise = new Promise((resolve) => resolveTask1Promise = resolve)
    queue.push({
      id: 'task-1',
      data: 'a',
      coalesce: (d) => d,
      execute: (d) => {
        executedTasks.push('task-1')
        return task1Promise
      }
    })

    let resolveTask2Promise
    const task2Promise = new Promise((resolve) => resolveTask2Promise = resolve)
    queue.push({
      id: 'task-2',
      data: 'b',
      coalesce: (d) => d,
      execute: (d) => {
        executedTasks.push('task-2')
        return task2Promise
      }
    })

    let resolveTask3Promise
    const task3Promise = new Promise((resolve) => resolveTask3Promise = resolve)
    queue.push({
      id: 'task-3',
      data: 'c',
      coalesce: (d) => d,
      execute: (d) => {
        executedTasks.push('task-3')
        return task3Promise
      }
    })

    assert.deepEqual(executedTasks, ['task-1'])

    queue.cancelPending('task-2')
    resolveTask1Promise()
    resolveTask2Promise()
    resolveTask3Promise()
    await condition(() => !queue.isLooping())
    assert.deepEqual(executedTasks, ['task-1', 'task-3'])
  })

  test('dispose', async () => {
    const queue = new TaskQueue()
    const executedTasks = []

    let resolveTask1Promise
    const task1Promise = new Promise((resolve) => resolveTask1Promise = resolve)
    queue.push({
      id: 'task-1',
      data: 'a',
      coalesce: (d) => d,
      execute: (d) => {
        executedTasks.push('task-1')
        return task1Promise
      }
    })
    assert.deepEqual(executedTasks, ['task-1'])

    let resolveTask2Promise
    const task2Promise = new Promise((resolve) => resolveTask2Promise = resolve)
    queue.push({
      id: 'task-2',
      data: 'b',
      coalesce: (d) => d,
      execute: (d) => {
        executedTasks.push('task-2')
        return task2Promise
      }
    })
    assert.deepEqual(executedTasks, ['task-1'])

    queue.dispose()
    resolveTask1Promise()
    await task1Promise
    assert.deepEqual(executedTasks, ['task-1'])

    resolveTask2Promise()
    await task2Promise
    assert.deepEqual(executedTasks, ['task-1'])

    assert.throws(() => queue.push({id: 'task-3', data: 'c', coalesce: (d) => d, execute: (d) => {}}))
    assert.throws(() => queue.cancelPending('task-1'))
  })
})

function condition (fn, message) {
  return new Promise((resolve) => {
    function callback () {
      const result = fn()
      if (result) {
        resolve()
      } else {
        setTimeout(callback, 5)
      }
    }

    callback()
  })
}
