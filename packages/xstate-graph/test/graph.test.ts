import { Machine, StateNode, createMachine, State, EventObject } from 'xstate';
import {
  getStateNodes,
  getPathFromEvents,
  getSimplePaths,
  getShortestPaths,
  toDirectedGraph,
  StatePathsMap,
  StatePath
} from '../src/index';
import {
  getAdjacencyMap,
  serializeState,
  traverseShortestPaths,
  traverseSimplePaths
} from '../src/graph';
import { assign } from 'xstate';
import { mapValues } from 'xstate/lib/utils';

function getPathsMapSnapshot(
  pathsMap: StatePathsMap<any, EventObject>
): Record<string, any> {
  return mapValues(pathsMap, (plan) => {
    return plan.paths.map(getPathSnapshot);
  });
}

function getPathSnapshot(path: StatePath<any, any>) {
  return {
    state: path.state instanceof State ? path.state.value : path.state,
    steps: path.steps.map((step) => ({
      state: step.state instanceof State ? step.state.value : step.state,
      eventType: step.event.type
    }))
  };
}

describe('@xstate/graph', () => {
  const pedestrianStates = {
    initial: 'walk',
    states: {
      walk: {
        on: {
          PED_COUNTDOWN: {
            target: 'wait',
            actions: ['startCountdown']
          }
        }
      },
      wait: {
        on: {
          PED_COUNTDOWN: 'stop'
        }
      },
      stop: {},
      flashing: {}
    }
  };

  const lightMachine = Machine({
    key: 'light',
    initial: 'green',
    states: {
      green: {
        on: {
          TIMER: 'yellow',
          POWER_OUTAGE: 'red.flashing',
          PUSH_BUTTON: [
            {
              actions: ['doNothing'] // pushing the walk button never does anything
            }
          ]
        }
      },
      yellow: {
        on: {
          TIMER: 'red',
          POWER_OUTAGE: '#light.red.flashing'
        }
      },
      red: {
        on: {
          TIMER: 'green',
          POWER_OUTAGE: 'red.flashing'
        },
        ...pedestrianStates
      }
    }
  });

  interface CondMachineCtx {
    id: string;
  }
  type CondMachineEvents = { type: 'EVENT'; id: string } | { type: 'STATE' };

  const condMachine = Machine<CondMachineCtx, CondMachineEvents>({
    key: 'cond',
    initial: 'pending',
    states: {
      pending: {
        on: {
          EVENT: [
            {
              target: 'foo',
              cond: (_, e) => e.id === 'foo'
            },
            { target: 'bar' }
          ],
          STATE: [
            {
              target: 'foo',
              cond: (s) => s.id === 'foo'
            },
            { target: 'bar' }
          ]
        }
      },
      foo: {},
      bar: {}
    }
  });

  const parallelMachine = createMachine({
    type: 'parallel',
    key: 'p',
    states: {
      a: {
        initial: 'a1',
        states: {
          a1: {
            on: { 2: 'a2', 3: 'a3' }
          },
          a2: {
            on: { 3: 'a3', 1: 'a1' }
          },
          a3: {}
        }
      },
      b: {
        initial: 'b1',
        states: {
          b1: {
            on: { 2: 'b2', 3: 'b3' }
          },
          b2: {
            on: { 3: 'b3', 1: 'b1' }
          },
          b3: {}
        }
      }
    }
  });

  describe('getNodes()', () => {
    it('should return an array of all nodes', () => {
      const nodes = getStateNodes(lightMachine);
      expect(nodes.every((node) => node instanceof StateNode)).toBe(true);
      expect(nodes.map((node) => node.id).sort()).toEqual([
        'light.green',
        'light.red',
        'light.red.flashing',
        'light.red.stop',
        'light.red.wait',
        'light.red.walk',
        'light.yellow'
      ]);
    });

    it('should return an array of all nodes (parallel)', () => {
      const nodes = getStateNodes(parallelMachine);
      expect(nodes.every((node) => node instanceof StateNode)).toBe(true);
      expect(nodes.map((node) => node.id).sort()).toEqual([
        'p.a',
        'p.a.a1',
        'p.a.a2',
        'p.a.a3',
        'p.b',
        'p.b.b1',
        'p.b.b2',
        'p.b.b3'
      ]);
    });
  });

  describe('getShortestPaths()', () => {
    it('should return a mapping of shortest paths to all states', () => {
      const paths = getShortestPaths(lightMachine) as any;

      expect(getPathsMapSnapshot(paths)).toMatchSnapshot('shortest paths');
    });

    it('should return a mapping of shortest paths to all states (parallel)', () => {
      const paths = getShortestPaths(parallelMachine) as any;
      expect(getPathsMapSnapshot(paths)).toMatchSnapshot(
        'shortest paths parallel'
      );
    });

    it('the initial state should have a zero-length path', () => {
      const shortestPaths = getShortestPaths(lightMachine);

      expect(
        shortestPaths[serializeState(lightMachine.initialState)].paths[0].steps
      ).toHaveLength(0);
    });

    xit('should not throw when a condition is present', () => {
      expect(() => getShortestPaths(condMachine)).not.toThrow();
    });

    it('should represent conditional paths based on context', () => {
      // explicit type arguments could be removed once davidkpiano/xstate#652 gets resolved
      const paths = getShortestPaths(
        condMachine.withContext({
          id: 'foo'
        }),
        {
          getEvents: () =>
            [
              {
                type: 'EVENT',
                id: 'whatever'
              },
              {
                type: 'STATE'
              }
            ] as any[]
        }
      );

      expect(getPathsMapSnapshot(paths)).toMatchSnapshot(
        'shortest paths conditional'
      );
    });
  });

  describe('getSimplePaths()', () => {
    it('should return a mapping of arrays of simple paths to all states', () => {
      const paths = getSimplePaths(lightMachine);

      expect(Object.keys(paths)).toMatchInlineSnapshot(`
        Array [
          "\\"green\\" |  | \\"\\"",
          "\\"yellow\\" |  | \\"\\"",
          "{\\"red\\":\\"flashing\\"} |  | \\"\\"",
          "\\"green\\" |  | \\"doNothing\\"",
          "{\\"red\\":\\"walk\\"} |  | \\"\\"",
          "{\\"red\\":\\"wait\\"} |  | \\"startCountdown\\"",
          "{\\"red\\":\\"stop\\"} |  | \\"\\"",
        ]
      `);

      expect(getPathsMapSnapshot(paths)).toMatchSnapshot();
    });

    const equivMachine = createMachine({
      initial: 'a',
      states: {
        a: { on: { FOO: 'b', BAR: 'b' } },
        b: { on: { FOO: 'a', BAR: 'a' } }
      }
    });

    it('should return a mapping of simple paths to all states (parallel)', () => {
      const paths = getSimplePaths(parallelMachine);

      expect(Object.keys(paths)).toMatchInlineSnapshot(`
        Array [
          "{\\"a\\":\\"a1\\",\\"b\\":\\"b1\\"} |  | \\"\\"",
          "{\\"a\\":\\"a2\\",\\"b\\":\\"b2\\"} |  | \\"\\"",
          "{\\"a\\":\\"a3\\",\\"b\\":\\"b3\\"} |  | \\"\\"",
        ]
      `);
      expect(getPathsMapSnapshot(paths)).toMatchSnapshot(
        'simple paths parallel'
      );
    });

    it('should return multiple paths for equivalent transitions', () => {
      const paths = getSimplePaths(equivMachine);

      expect(Object.keys(paths)).toMatchInlineSnapshot(`
        Array [
          "\\"a\\" |  | \\"\\"",
          "\\"b\\" |  | \\"\\"",
        ]
      `);
      expect(getPathsMapSnapshot(paths)).toMatchSnapshot(
        'simple paths equal transitions'
      );
    });

    it('should return a single empty path for the initial state', () => {
      expect(
        getSimplePaths(lightMachine)[serializeState(lightMachine.initialState)]
          .paths
      ).toHaveLength(1);
      expect(
        getSimplePaths(lightMachine)[serializeState(lightMachine.initialState)]
          .paths[0].steps
      ).toHaveLength(0);
      expect(
        getSimplePaths(equivMachine)[serializeState(equivMachine.initialState)]
          .paths
      ).toHaveLength(1);
      expect(
        getSimplePaths(equivMachine)[serializeState(equivMachine.initialState)]
          .paths[0].steps
      ).toHaveLength(0);
    });

    it('should return value-based paths', () => {
      interface Ctx {
        count: number;
      }
      interface Events {
        type: 'INC';
        value: number;
      }
      const countMachine = createMachine<Ctx, Events>({
        id: 'count',
        initial: 'start',
        context: {
          count: 0
        },
        states: {
          start: {
            always: {
              target: 'finish',
              cond: (ctx) => ctx.count === 3
            },
            on: {
              INC: {
                actions: assign({
                  count: (ctx) => ctx.count + 1
                })
              }
            }
          },
          finish: {}
        }
      });

      const paths = getSimplePaths(countMachine as any, {
        getEvents: () => [{ type: 'INC', value: 1 }]
      });

      expect(Object.keys(paths)).toMatchInlineSnapshot(`
        Array [
          "\\"start\\" | {\\"count\\":0} | \\"\\"",
          "\\"start\\" | {\\"count\\":1} | \\"\\"",
          "\\"start\\" | {\\"count\\":2} | \\"\\"",
          "\\"finish\\" | {\\"count\\":3} | \\"\\"",
        ]
      `);
      expect(getPathsMapSnapshot(paths)).toMatchSnapshot(
        'simple paths context'
      );
    });
  });

  describe('getPathFromEvents()', () => {
    it('should return a path to the last entered state by the event sequence', () => {
      const path = getPathFromEvents(lightMachine, [
        { type: 'TIMER' },
        { type: 'TIMER' },
        { type: 'TIMER' },
        { type: 'POWER_OUTAGE' }
      ]);

      expect(getPathSnapshot(path)).toMatchSnapshot('path from events');
    });

    it.skip('should throw when an invalid event sequence is provided', () => {
      expect(() =>
        getPathFromEvents(lightMachine, [
          { type: 'TIMER' },
          { type: 'INVALID_EVENT' }
        ])
      ).toThrow();
    });
  });

  describe('getAdjacencyMap', () => {
    it('should map adjacencies', () => {
      interface Ctx {
        count: number;
        other: string;
      }
      type Events = { type: 'INC'; value: number } | { type: 'DEC' };

      const counterMachine = createMachine<Ctx, Events>({
        id: 'counter',
        initial: 'empty',
        context: {
          count: 0,
          other: 'something'
        },
        states: {
          empty: {
            always: {
              target: 'full',
              cond: (ctx) => ctx.count === 5
            },
            on: {
              INC: {
                actions: assign({
                  count: (ctx, e) => ctx.count + e.value
                })
              },
              DEC: {
                actions: assign({
                  count: (ctx) => ctx.count - 1
                })
              }
            }
          },
          full: {}
        }
      });

      // explicit type arguments could be removed once davidkpiano/xstate#652 gets resolved
      const adj = getAdjacencyMap(counterMachine, {
        filter: (state) => state.context.count >= 0 && state.context.count <= 5,
        stateSerializer: (state) => {
          const ctx = {
            count: state.context.count
          };
          return JSON.stringify(state.value) + ' | ' + JSON.stringify(ctx);
        },
        events: {
          INC: [{ type: 'INC', value: 1 }]
        }
      });

      expect(adj).toHaveProperty('"full" | {"count":5}');
    });

    it('should get events via function', () => {
      const machine = createMachine<
        { count: number },
        { type: 'EVENT'; value: number }
      >({
        initial: 'first',
        context: {
          count: 0
        },
        states: {
          first: {
            on: {
              EVENT: {
                target: 'second',
                actions: assign({
                  count: (_, event) => event.value
                })
              }
            }
          },
          second: {}
        }
      });

      const adj = getAdjacencyMap(machine, {
        events: {
          EVENT: (state) => [
            { type: 'EVENT' as const, value: state.context.count + 10 }
          ] // TODO: fix as const
        }
      });

      expect(adj).toHaveProperty('"second" | {"count":10} | ""');
    });
  });

  describe('toDirectedGraph', () => {
    it('should represent a statechart as a directed graph', () => {
      const machine = createMachine({
        id: 'light',
        initial: 'green',
        states: {
          green: { on: { TIMER: 'yellow' } },
          yellow: { on: { TIMER: 'red' } },
          red: {
            initial: 'walk',
            states: {
              walk: { on: { COUNTDOWN: 'wait' } },
              wait: { on: { COUNTDOWN: 'stop' } },
              stop: { on: { COUNTDOWN: 'finished' } },
              finished: { type: 'final' }
            },
            onDone: 'green'
          }
        }
      });

      const digraph = toDirectedGraph(machine);

      expect(digraph).toMatchSnapshot();
    });
  });
});

it('simple paths for reducers', () => {
  const a = traverseShortestPaths(
    {
      transition: (s, e) => {
        if (e.type === 'a') {
          return 1;
        }
        if (e.type === 'b' && s === 1) {
          return 2;
        }
        if (e.type === 'reset') {
          return 0;
        }
        return s;
      },
      initialState: 0 as number
    },
    {
      getEvents: () => [{ type: 'a' }, { type: 'b' }, { type: 'reset' }],
      serializeState: (v, e) =>
        (JSON.stringify(v) + ' | ' + JSON.stringify(e)) as any
    }
  );

  expect(getPathsMapSnapshot(a)).toMatchSnapshot();
});

it('shortest paths for reducers', () => {
  const a = traverseSimplePaths(
    {
      transition: (s, e) => {
        if (e.type === 'a') {
          return 1;
        }
        if (e.type === 'b' && s === 1) {
          return 2;
        }
        if (e.type === 'reset') {
          return 0;
        }
        return s;
      },
      initialState: 0 as number
    },
    {
      getEvents: () => [{ type: 'a' }, { type: 'b' }, { type: 'reset' }],
      serializeState: (v, e) =>
        (JSON.stringify(v) + ' | ' + JSON.stringify(e)) as any
    }
  );

  expect(getPathsMapSnapshot(a)).toMatchSnapshot();
});

describe('filtering', () => {
  it('should not traverse past filtered states', () => {
    const machine = createMachine<{ count: number }>({
      initial: 'counting',
      context: { count: 0 },
      states: {
        counting: {
          on: {
            INC: {
              actions: assign({
                count: (ctx) => ctx.count + 1
              })
            }
          }
        }
      }
    });

    const sp = getShortestPaths(machine, {
      getEvents: () => [{ type: 'INC' }],
      filter: (s) => s.context.count < 5
    });

    expect(Object.keys(sp)).toMatchInlineSnapshot(`
      Array [
        "\\"counting\\" | {\\"count\\":0} | \\"\\"",
        "\\"counting\\" | {\\"count\\":1} | \\"\\"",
        "\\"counting\\" | {\\"count\\":2} | \\"\\"",
        "\\"counting\\" | {\\"count\\":3} | \\"\\"",
        "\\"counting\\" | {\\"count\\":4} | \\"\\"",
      ]
    `);
  });
});
