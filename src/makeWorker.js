// outside main thread

class Contexts {
  constructor() {
    this.contexts = {}
    this.nextContextId = 0
  }

  createContext() {
    this.nextContextId++
    const contextId = this.nextContextId
    this.contexts[contextId] = {}
    return contextId
  }

  destroyContext(contextId) {
    delete this.contexts[contextId]
    return Object.keys(this.contexts).length
  }

  extendContext(contextId, extension) {
    this.contexts[contextId] = { ...this.contexts[contextId], ...extension }
  }
}

class State {
  constructor() {
    this.publicState = {}

    this.listeners = {}
    this.listenerId = 0
  }

  setPublicState(getNewState) {
    const previousState = this.publicState
    this.publicState = getNewState(previousState)

    for (const listenerId in this.listeners) {
      const listener = this.listeners[listenerId]
      listener(this.publicState)
    }
  }

  addPublicStateListener(listener) {
    this.listenerId++

    this.listeners[this.listenerId] = listener
    return this.listenerId
  }

  removePublicStateListener(listenerId) {
    return delete this.listeners[listenerId]
  }
}

class SubWorkers {
  constructor(askMainThread, contextId) {
    this.askMainThread = askMainThread
    this.nextId = 0
    this.contextId = contextId
    this.listeners = {}
  }

  callMethod = (workerPath, methodName, ...args) => {
    this.nextId++
    const id = this.nextId

    this.askMainThread({
      requestName: 'callSubWorkerMethod',
      contextId: this.contextId,
      requestId: id,
      workerPath,
      methodName,
      args,
    })

    return new Promise(
      (resolve, reject) => (this.listeners[id] = { resolve, reject })
    )
  }

  receiveMethodCallResult = ({ requestId, result, error }) => {
    if (!this.listeners[requestId]) return
    const { resolve, reject } = this.listeners[requestId]
    delete this.listeners[requestId]
    if (error) reject(error)
    else resolve(result)
  }
}

const handlers = {
  createContext: ({}, { classes, answer }) => {
    const contextId = classes.contexts.createContext()

    const state = new classes.State()
    const subWorkers = new SubWorkers(answer, contextId)

    classes.contexts.extendContext(contextId, {
      state,
      subWorkers,
    })
    classes.subWorkersHandlers.set(
      contextId,
      subWorkers.receiveMethodCallResult
    )

    return contextId
  },
  destroyContext: ({ contextId }, { classes }) => {
    classes.subWorkersHandlers.delete(contextId)
    return classes.contexts.destroyContext(contextId)
  },
  receiveSubWorkerMethodCallResult: ({ contextId, ...rest }, { classes }) => {
    const handler = classes.subWorkersHandlers.get(contextId)
    if (handler) handler(rest)
  },
  subscribeToPublicState: ({ contextId }, { classes, answer }) => {
    const context = classes.contexts[contextId]
    const listener = (state) => answer({ type: 'state', v: state })
    const listenerId = context.state.addPublicStateListener(listener)
    return { type: 'listenerId', v: listenerId }
  },
  unsubscribeFromWorkerPublicState: (data, { classes }) => {
    const { contextId, listenerId } = data
    const context = classes.contexts[contextId]
    return context.state.removePublicStateListener(listenerId)
  },
  getMethodsList: ({}, { methods }) => Object.keys(methods ? methods : {}),
  callWorkerMethod: ({ methodName, contextId, args }, { classes, methods }) => {
    const context = classes.contexts.contexts[contextId]
    return methods[methodName].apply(context, args)
  },
}

function makeWorker(methods) {
  const classes = {
    contexts: new Contexts(),
    subWorkersHandlers: new Map(),
    State,
    SubWorkers,
  }

  self.onmessage = ({ data = {} }) => {
    const { callId, activityName } = data

    const answer = (result) => {
      const isResultPromise = result ? !!result.then : false

      if (!isResultPromise) postMessage({ callId, result })
      else
        result
          .then((r) => postMessage({ callId, result: r }))
          .catch((error) => postMessage({ callId, error }))
    }

    try {
      answer(handlers[activityName](data, { classes, methods, answer, callId }))
    } catch (error) {
      postMessage({ callId, error })
    }
  }
}

export { makeWorker }
