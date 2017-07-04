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
    assert.deepEqual(executedTasks, ['task-1', 'task-2', 'task-3', 'task-4'])
  })

  test('coalescing', async () => {
    const queue = new TaskQueue()
    const executedTasks = []

    queue.push({
      id: 'task-1',
      data: 'a',
      coalesce: (data) => data.reduce((a, b) => a + b),
      execute: (data) => {
        executedTasks.push({id: 'task-1', data})
        return Promise.resolve()
      }
    })

    queue.push({
      id: 'task-1',
      data: 'b',
      coalesce: (data) => data.reduce((a, b) => a + b),
      execute: (data) => {
        executedTasks.push({id: 'task-1', data})
        return Promise.resolve()
      }
    })
    queue.push({
      id: 'task-1',
      data: 'c',
      coalesce: (data) => data.reduce((a, b) => a + b),
      execute: (data) => {
        executedTasks.push({id: 'task-1', data})
        return Promise.resolve()
      }
    })

    queue.push({
      id: 'task-2',
      data: 'd',
      coalesce: (data) => data.reduce((a, b) => a + b),
      execute: (data) => {
        executedTasks.push({id: 'task-2', data})
        return Promise.resolve()
      }
    })
    queue.push({
      id: 'task-2',
      data: 'e',
      coalesce: (data) => data.reduce((a, b) => a + b),
      execute: (data) => {
        executedTasks.push({id: 'task-2', data})
        return Promise.resolve()
      }
    })

    await condition(() => !queue.isLooping())
    assert.deepEqual(
      executedTasks,
      [{id: 'task-1', data: 'a'}, {id: 'task-1', data: 'bc'}, {id: 'task-2', data: 'de'}]
    )
  })

  test('pending task cancellation', async () => {
    const queue = new TaskQueue()
    const executedTasks = []

    queue.push({
      id: 'task-1',
      data: 'a',
      coalesce: (d) => d,
      execute: (d) => {
        executedTasks.push('task-1')
        return Promise.resolve()
      }
    })
    queue.push({
      id: 'task-2',
      data: 'b',
      coalesce: (d) => d,
      execute: (d) => {
        executedTasks.push('task-2')
        return Promise.resolve()
      }
    })
    queue.push({
      id: 'task-3',
      data: 'c',
      coalesce: (d) => d,
      execute: (d) => {
        executedTasks.push('task-3')
        return Promise.resolve()
      }
    })
    assert.deepEqual(executedTasks, ['task-1'])

    queue.cancelPending('task-2')
    await condition(() => !queue.isLooping())
    assert.deepEqual(executedTasks, ['task-1', 'task-3'])
  })

  test('dispose', async () => {
    const queue = new TaskQueue()
    const executedTasks = []

    queue.push({
      id: 'task-1',
      data: 'a',
      coalesce: (d) => d,
      execute: (d) => {
        executedTasks.push('task-1')
        return Promise.resolve()
      }
    })
    queue.push({
      id: 'task-2',
      data: 'b',
      coalesce: (d) => d,
      execute: (d) => {
        executedTasks.push('task-2')
        return Promise.resolve()
      }
    })

    queue.dispose()
    await condition(() => !queue.isLooping())
    assert.deepEqual(executedTasks, ['task-1'])
    assert.throws(() => queue.push({id: 'task-3', data: 'c', coalesce: (d) => d, execute: (d) => {}}))
    assert.throws(() => queue.cancelPending('task-1'))
  })
})

function condition (fn) {
  return new Promise((resolve) => {
    const intervalId = setInterval(() => {
      if (fn()) {
        clearInterval(intervalId)
        resolve()
      }
    }, 5)
  })
}
