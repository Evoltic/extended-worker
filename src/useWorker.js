// inside main thread

export class ExtendedWorker {
  constructor(worker, useAnotherExtendedWorker, orderTermination) {
    this.nextCallId = 0

    this.worker = worker
    this.orderTermination = orderTermination || ((terminate) => terminate())
    this.useAnotherExtendedWorker = useAnotherExtendedWorker
  }

  terminate() {
    this.orderTermination(() => this.worker.terminate())
  }

  sendMessage(message, callBackOnResponse) {
    const callId = this.nextCallId
    this.nextCallId++

    this.worker.postMessage({ ...message, callId })

    const listener = ({ data = {} }) => {
      if (data.callId !== callId) return
      callBackOnResponse(data.error, data.result)
    }
    this.worker.addEventListener('message', listener)

    return () => this.worker.removeEventListener('message', listener)
  }

  sendMessagePromisified(message) {
    // notice: all worker responses except the first will be ignored
    return new Promise((resolve, reject) => {
      const unsubscribe = this.sendMessage(message, (err, res) => {
        unsubscribe()
        if (err) reject(err)
        else resolve(res)
      })
    })
  }

  listenForRequest(requestName, contextId, handler) {
    const listener = ({ data = {} }) => {
      const { result: res = {} } = data

      if (res.requestName === requestName && res.contextId === contextId) {
        handler(res)
      }
    }
    this.worker.addEventListener('message', listener)
    return () => this.worker.removeEventListener('message', listener)
  }

  async createContext() {
    const contextId = await this.sendMessagePromisified({
      activityName: 'createContext',
    })
    return contextId
  }

  async destroyContext(contextId) {
    const contextsLeft = await this.sendMessagePromisified({
      activityName: 'destroyContext',
      contextId,
    })
    if (contextsLeft === 0) this.terminate()
  }

  async getMethods(contextId) {
    const workerMethodsList = await this.sendMessagePromisified({
      activityName: 'getMethodsList',
    })

    let methods = {}
    for (const methodName of workerMethodsList) {
      methods[methodName] = (...args) =>
        this.sendMessagePromisified({
          activityName: 'callWorkerMethod',
          methodName,
          contextId,
          args,
        })
    }
    return methods
  }

  async subscribeToWorkerPublicState(contextId, subscriber) {
    let listenerId

    const removeMessageListener = this.sendMessage(
      {
        activityName: 'subscribeToPublicState',
        contextId,
      },
      (err, { type, v } = {}) => {
        if (err) subscriber(err)
        if (type === 'state') subscriber(undefined, v)
        else if (type === 'listenerId') listenerId = v
      }
    )

    return async () => {
      removeMessageListener()
      await this.sendMessagePromisified({
        activityName: 'unsubscribeFromPublicState',
        contextId,
        listenerId,
      })
    }
  }

  callSubWorkerMethod = async (data) => {
    const { workerPath, methodName, args, ...concomitant } = data

    let message
    let subWorker

    try {
      subWorker = await this.useAnotherExtendedWorker(workerPath)
      const result = await subWorker[methodName](...args)
      await subWorker.destroyContext()

      message = { result, error: undefined }
    } catch (error) {
      message = { result: undefined, error }
    }

    await this.sendMessagePromisified({
      activityName: 'receiveSubWorkerMethodCallResult',
      ...concomitant,
      ...message,
    })
  }

  async use() {
    const contextId = await this.createContext()

    const removeSubWorkerCallListener = this.listenForRequest(
      'callSubWorkerMethod',
      contextId,
      this.callSubWorkerMethod
    )

    const methods = await this.getMethods(contextId)

    return {
      ...methods,
      subscribeToWorkerPublicState: async (subscriber) => {
        return this.subscribeToWorkerPublicState(contextId, subscriber)
      },
      destroyContext: async () => {
        removeSubWorkerCallListener()
        return this.destroyContext(contextId)
      },
    }
  }
}

export class WorkersPool {
  constructor(options = {}) {
    const { createWorker, permanentWorkers = [] } = options
    this.createWorker = createWorker
    this.workers = {}
    this.permanentWorkers = permanentWorkers
  }

  checkOut(workerPath) {
    if (this.workers[workerPath]) return this.workers[workerPath]

    const orderTermination = (terminateWorker) =>
      this.terminate(workerPath, terminateWorker)

    this.workers[workerPath] = this.createWorker(workerPath, orderTermination)
    return this.workers[workerPath]
  }

  terminate(workerPath, terminateWorker) {
    if (this.permanentWorkers.includes(workerPath)) return

    delete this.workers[workerPath]
    terminateWorker()
  }
}

const workersPool = new WorkersPool({
  createWorker: (workerPath, orderTermination) => {
    const worker = new Worker(workerPath)
    return new ExtendedWorker(worker, useWorker, orderTermination)
  }
})

export const setPermanentWorkers = (permanentWorkers) => {
  workersPool.permanentWorkers = permanentWorkers
}

export const useWorker = async (workerPath) => {
  const extendedWorker = workersPool.checkOut(workerPath)
  return extendedWorker.use()
}
