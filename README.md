# Extended worker library
A wrapper for a web worker

## Basic usage

Use **makeWorker** function inside a worker file to attach the library 
interface to methods.

```
// /someDir/calculator.worker.js

import { makeWorker } from 'extended-worker/makeWorker'

function multiply(a, b) {
    return a*b
}

function divide(a, b) {
    return a/b
}

makeWorker({ multiply, divide })
```

Use **useWorker** function in the main thread to get access to the worker methods
from the main thread.

```
// /someDir/calculator.js

import { useWorker } from 'extended-worker/useWorker'

async function calculate() {
    const { 
        multiply, 
        divide, 
        destroyContext 
    } = await useWorker('/someDir/calculator.worker.js')
    
    const a = await divide(999, 333)
    const b = await multiply(333, 3)
    
    await destroyContext()
    
    return [a, b]
}
```

So, you only need **makeWorker** and **useWorker** to start working with 
workers.

### How it works

On **makeWorker** call, the function just wraps passed methods 
to provide the necessary interface for **useWorker**.

On **useWorker** call, the function does few things:  
- It checks is a worker already spawned:
    - if no, then spawns and creates a unique context for the spawned,
    - if yes, then creates a unique context for the spawned;
- Returns the worker methods and additional methods (e.g. destroyContext).  

For the same worker **useWorker** call will create a new context.  

It is important to call **destroyContext** 
when functions (worker methods) returned by **useWorker** won't be used anymore,
so the context could be destroyed to free memory and if no contexts left,
then even destroy a worker itself.

## React, Vue etc

It's not quite simple to use **useWorker** in a component, because of 
keeping in mind syncing a component lifecycle with a worker lifecycle and
maintaining the order (a worker is ready -> a method call).

So, forget about using **useWorker** function and welcome **AutoWorker**

### AutoWorker

**AutoWorker** just wraps all **useWorker** functionality to provide more
simple usage.

```
// /calculorUI.js

import React from 'react'
import { AutoWorker } from 'extended-worker/autoWorker'

class CalculatorUI extends React.Component {
    constructor(props) {
        super(props)
        this.autoWorker = new AutoWorker('/someDir/calculator.worker.js')
    }

    componentDidMount() {
        this.autoWorker.create()
    }

    componentWillUnmount() {
        this.autoWorker.destroy()
    }
    
    multiply(a, b) {
        this.autoWorker.do('multiply', a, b).then(result => alert(result))
    }

    render() {
        return (
            <button onClick={(event) => this.multiply(2, 3)}>
                multiply 2 by 3
            </button>
        )
    }
  }
```

So, the library could be easily integrated with any UI framework.  
Just call **autoWorker.create** on a component mount, 
**autoWorker.destroy** on unmount, 
and **autoWorker.do** to call a worker method.
