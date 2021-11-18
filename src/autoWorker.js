import { useWorker } from './useWorker'

export class QueueTask {
  constructor(task) {
    this.func = task.func
    this.resolve = task.resolve
    this.reject = task.reject
  }
}

export class AsyncQueue {
  constructor() {
    this.queue = []
  }

  add = (task) => {
    this.queue.push(new QueueTask(task))
  }

  executeAll = async () => {
    let promises = []

    for (const task of this.queue) {
      const promise = task.func().then(task.resolve).catch(task.reject)
      promises.push(promise)
    }

    await Promise.all(promises)

    this.queue = []
  }

  rejectAll = (reason) => {
    this.queue.map((task) => task.reject(reason))
  }
}

export class AutoWorker {
  constructor(workerPath, options = {}) {
    this.useWorker = options.useWorker || useWorker
    this.workerPath = workerPath
    this.queue = new AsyncQueue()

    this.workerMethods = undefined
    this.isWorkerStillRelevant = true
  }

  do = async (methodName, ...args) => {
    const isWorkerReady = this.workerMethods !== undefined

    if (isWorkerReady) {
      return this.workerMethods[methodName](...args)
    } else {
      return new Promise((resolve, reject) => {
        this.queue.add({
          func: () => this.workerMethods[methodName](...args),
          resolve,
          reject,
        })
      })
    }
  }

  create = async () => {
    this.workerMethods = await this.useWorker(this.workerPath)

    if (this.isWorkerStillRelevant) {
      return this.queue.executeAll()
    } else {
      throw new Error('.create called after .destroy')
    }
  }

  destroy = async (tasksRejectMessage) => {
    this.isWorkerStillRelevant = false
    this.queue.rejectAll(
      tasksRejectMessage ||
        'the worker will be destroyed, so no need for the task anymore'
    )
    if (this.workerMethods) return this.workerMethods.destroyContext()
  }
}
