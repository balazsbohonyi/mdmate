/**
 * A small Chrome DevTools Protocol client for WebView2's debugging port. The harness uses it to
 * send real key events to the page, which a script inside the page cannot do.
 */

interface Reply {
  id?: number
  result?: unknown
  error?: { message: string }
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export class Cdp {
  private nextId = 1
  private readonly waiting = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()

  private readonly socket: WebSocket

  private constructor(socket: WebSocket) {
    this.socket = socket
    socket.addEventListener('message', (event) => {
      const reply = JSON.parse(String(event.data)) as Reply
      if (reply.id === undefined) return
      const entry = this.waiting.get(reply.id)
      if (!entry) return
      this.waiting.delete(reply.id)
      if (reply.error) entry.reject(new Error(reply.error.message))
      else entry.resolve(reply.result)
    })
    socket.addEventListener('close', () => {
      for (const entry of this.waiting.values()) entry.reject(new Error('the page closed'))
      this.waiting.clear()
    })
  }

  /** Waits for the app's page to appear on the debugging port, then connects to it. */
  static async connect(port: number, timeoutMs: number): Promise<Cdp> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        const list = (await (await fetch(`http://127.0.0.1:${String(port)}/json/list`)).json()) as {
          type: string
          webSocketDebuggerUrl?: string
        }[]
        const page = list.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
        if (page?.webSocketDebuggerUrl) {
          const socket = new WebSocket(page.webSocketDebuggerUrl)
          await new Promise<void>((resolve, reject) => {
            socket.addEventListener('open', () => {
              resolve()
            })
            socket.addEventListener('error', () => {
              reject(new Error('could not open the DevTools socket'))
            })
          })
          return new Cdp(socket)
        }
      } catch {
        // The app is still starting. Try again until the deadline.
      }
      await sleep(100)
    }
    throw new Error(
      `no page appeared on debugging port ${String(port)} within ${String(timeoutMs)} ms`,
    )
  }

  send(method: string, params: object = {}): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  /** Evaluates an expression in the page and returns its value, waiting for a promise if asked. */
  async evaluate(expression: string, awaitPromise = false): Promise<unknown> {
    const reply = (await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise,
    })) as {
      result?: { value?: unknown }
      exceptionDetails?: { text?: string; exception?: { description?: string } }
    }
    if (reply.exceptionDetails) {
      const { text, exception } = reply.exceptionDetails
      throw new Error(`the page threw: ${exception?.description ?? text ?? 'unknown error'}`)
    }
    return reply.result?.value
  }

  close(): void {
    this.socket.close()
  }
}

/** Sends `total` real key presses, `intervalMs` apart, once the page says it is ready. */
export async function driveTyping(
  port: number,
  { total, intervalMs }: { total: number; intervalMs: number },
): Promise<void> {
  const cdp = await Cdp.connect(port, 30_000)
  try {
    // Keys go to the page even when Windows has not made its window the foreground one.
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })

    const deadline = Date.now() + 60_000
    while ((await cdp.evaluate('window.__perfReady === true')) !== true) {
      if (Date.now() > deadline) throw new Error('the page never reported it was ready for keys')
      await sleep(50)
    }

    for (let i = 0; i < total; i++) {
      const character = String.fromCharCode(97 + (i % 26))
      const key = {
        key: character,
        code: `Key${character.toUpperCase()}`,
        windowsVirtualKeyCode: character.toUpperCase().charCodeAt(0),
      }
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        text: character,
        unmodifiedText: character,
        ...key,
      })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key })
      // A random extra gap keeps the keys from lining up with the page's frame clock.
      await sleep(intervalMs + Math.random() * (1000 / 60))
    }
  } finally {
    cdp.close()
  }
}

/** One step of a mouse or key sequence the page asks the harness to play. */
export type DragAction =
  | { t: 'down' | 'move' | 'hover' | 'up'; x: number; y: number }
  | { t: 'key'; key: string; code: string; vk: number; modifiers?: number }
  | { t: 'wait'; ms: number }

async function play(cdp: Cdp, actions: readonly DragAction[]): Promise<void> {
  for (const action of actions) {
    if (action.t === 'wait') {
      await sleep(action.ms)
    } else if (action.t === 'key') {
      const key = {
        key: action.key,
        code: action.code,
        windowsVirtualKeyCode: action.vk,
        modifiers: action.modifiers ?? 0,
      }
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...key })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key })
    } else if (action.t === 'down') {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: action.x,
        y: action.y,
        button: 'left',
        buttons: 1,
        clickCount: 1,
      })
    } else if (action.t === 'move') {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: action.x,
        y: action.y,
        button: 'left',
        buttons: 1,
      })
    } else if (action.t === 'hover') {
      // A move with no button held: after a press, this is what a lost mouse-up looks like.
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: action.x,
        y: action.y,
        button: 'none',
        buttons: 0,
      })
    } else {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: action.x,
        y: action.y,
        button: 'left',
        buttons: 0,
        clickCount: 1,
      })
    }
  }
}

/**
 * Plays the drag cases the page offers: for each name the page returns a plan of real (trusted)
 * mouse and key events, the harness sends them through the DevTools port, and the page checks the
 * result itself. No real cursor moves, so nothing here interrupts the person at the keyboard.
 */
export async function driveDrag(port: number): Promise<void> {
  const cdp = await Cdp.connect(port, 30_000)
  try {
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    const deadline = Date.now() + 60_000
    while ((await cdp.evaluate('window.__dragReady === true')) !== true) {
      if (Date.now() > deadline) throw new Error('the page never reported it was ready for drags')
      await sleep(50)
    }
    const names = JSON.parse(
      String(await cdp.evaluate('JSON.stringify(window.__dragLab.names())')),
    ) as string[]
    for (const name of names) {
      const quoted = JSON.stringify(name)
      const text = await cdp.evaluate(
        `window.__dragLab.prepare(${quoted}).then((plan) => JSON.stringify(plan))`,
        true,
      )
      await play(cdp, JSON.parse(String(text)) as DragAction[])
      await cdp.evaluate(`window.__dragLab.check(${quoted}).then(() => true)`, true)
    }
    await cdp.evaluate('window.__dragLab.finish()')
  } finally {
    cdp.close()
  }
}
