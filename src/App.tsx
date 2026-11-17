import { useEffect, useState } from 'react'
import oryaLogo from '../orya-logo.png'
import './App.css'

const STORAGE_KEY = 'orya-bench-coach'
const DEFAULT_SKATER_COUNT = 10
const PLAYERS_PER_SHIFT = 4

type Pair = {
  id: number
  playerAId: number
  playerBId: number
}

type Player = {
  id: number
  name: string
}

type GameState = {
  players: Player[]
  goalieName: string
  pairs: Pair[]
  flexPlayerIds: number[]
  shift: number
}

type SavedPair = {
  id?: number
  playerAId?: number | null
  playerBId?: number | null
  playerA?: string
  playerB?: string
}

type SavedGame = {
  players?: Array<Partial<Player>>
  goalieName?: string
  goalieId?: number | null
  pairs?: SavedPair[]
  flexPlayerIds?: number[]
  shift?: number
}

type WakeLockSentinel = {
  release: () => Promise<void>
  addEventListener: (type: 'release', listener: () => void) => void
}

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: {
    request: (type: 'screen') => Promise<WakeLockSentinel>
  }
}

type WakeStatus = 'off' | 'active' | 'unsupported' | 'unavailable'

function createPlayers(count = DEFAULT_SKATER_COUNT): Player[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    name: '',
  }))
}

function createGame(): GameState {
  return { players: createPlayers(), goalieName: '', pairs: [], flexPlayerIds: [], shift: 1 }
}

function loadGame(): GameState {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved) as SavedGame
      const shift = Number.isInteger(parsed.shift) && parsed.shift! >= 1 ? parsed.shift! : 1

      if (Array.isArray(parsed.players) && typeof parsed.goalieName === 'string') {
        const players = parsed.players.map((player, index) => ({
          id: Number.isInteger(player.id) && player.id! > 0 ? player.id! : index + 1,
          name: typeof player.name === 'string' ? player.name : '',
        }))
        if (players.length === 11 && players.every((player) => !player.name.trim())
          && !parsed.goalieName.trim() && !parsed.pairs?.length) {
          return { ...createGame(), shift }
        }
        const playerIds = new Set(players.map((player) => player.id))
        const usedIds = new Set<number>()
        const pairs = (parsed.pairs ?? []).flatMap((pair, index) => {
          const { playerAId, playerBId } = pair
          if (!playerAId || !playerBId || playerAId === playerBId
            || !playerIds.has(playerAId) || !playerIds.has(playerBId)
            || usedIds.has(playerAId) || usedIds.has(playerBId)) return []
          usedIds.add(playerAId)
          usedIds.add(playerBId)
          return [{ id: index + 1, playerAId, playerBId }]
        })
        const flexPlayerIds = pairs.length
          ? [...new Set(parsed.flexPlayerIds ?? [])].filter((playerId) => playerIds.has(playerId) && !usedIds.has(playerId))
          : []
        if (pairs.length) {
          for (const player of players) {
            if (!usedIds.has(player.id) && !flexPlayerIds.includes(player.id)) flexPlayerIds.push(player.id)
          }
        }

        return {
          players,
          goalieName: parsed.goalieName,
          pairs,
          flexPlayerIds,
          shift,
        }
      }

      if (Array.isArray(parsed.players)) {
        const legacyPlayers = parsed.players.map((player, index) => ({
          id: index + 1,
          name: typeof player.name === 'string' ? player.name : '',
        }))
        const legacyGoalie = legacyPlayers.find((player) => player.id === parsed.goalieId)
        const players = legacyPlayers.filter((player) => player.id !== parsed.goalieId)
        const playerIds = new Set(players.map((player) => player.id))
        const usedIds = new Set<number>()
        const pairs = (parsed.pairs ?? []).flatMap((pair, index) => {
          const { playerAId, playerBId } = pair
          if (!playerAId || !playerBId || playerAId === playerBId
            || !playerIds.has(playerAId) || !playerIds.has(playerBId)
            || usedIds.has(playerAId) || usedIds.has(playerBId)) return []
          usedIds.add(playerAId)
          usedIds.add(playerBId)
          return [{ id: index + 1, playerAId, playerBId }]
        })
        const flexPlayerIds = pairs.length
          ? players.map((player) => player.id).filter((playerId) => !usedIds.has(playerId))
          : []

        return { players, goalieName: legacyGoalie?.name ?? '', pairs, flexPlayerIds, shift }
      }

      if (parsed.pairs?.length) {
        const legacyPairs = parsed.pairs as SavedPair[]
        const players = legacyPairs.flatMap((pair) => [pair.playerA, pair.playerB])
          .filter((name): name is string => typeof name === 'string' && Boolean(name.trim()) && !/^Pair \d+$/i.test(name.trim()))
          .map((name, index) => ({ id: index + 1, name }))
        if (players.length) {
          const pairs = Array.from({ length: Math.floor(players.length / 2) }, (_, index) => ({
            id: index + 1,
            playerAId: players[index * 2].id,
            playerBId: players[index * 2 + 1].id,
          }))
          return {
            players,
            goalieName: '',
            pairs,
            flexPlayerIds: players.length % 2 ? [players[players.length - 1].id] : [],
            shift,
          }
        }
      }
    }
  } catch {
    // Start fresh if saved game data is unavailable or malformed.
  }

  return createGame()
}

type ShiftLine = {
  playerIds: [number, number]
  pairId: number | null
}

type ShiftAssignments = {
  offense: ShiftLine
  defense: ShiftLine
}

function lineName(line: ShiftLine | null, players: Player[]): string {
  if (!line) return 'Pairing needed'
  return line.playerIds
    .map((playerId) => players.find((player) => player.id === playerId)?.name.trim() ?? '')
    .filter(Boolean)
    .join(' + ') || 'Pairing needed'
}

function greatestCommonDivisor(left: number, right: number): number {
  return right === 0 ? left : greatestCommonDivisor(right, left % right)
}

function getShiftLines(game: GameState, shift: number): ShiftLine[] | null {
  const { players } = game
  if (players.length < PLAYERS_PER_SHIFT || game.pairs.length === 0) return null

  const pairedIds = game.pairs.flatMap((pair) => [pair.playerAId, pair.playerBId])
  const orderedIds = [...pairedIds, ...game.flexPlayerIds]
  for (const player of players) {
    if (!orderedIds.includes(player.id)) orderedIds.push(player.id)
  }
  if (orderedIds.length !== players.length) return null

  const firstIndex = ((shift - 1) * PLAYERS_PER_SHIFT) % orderedIds.length
  const activeIds = Array.from({ length: PLAYERS_PER_SHIFT }, (_, index) =>
    orderedIds[(firstIndex + index) % orderedIds.length],
  )
  const active = new Set(activeIds)
  const used = new Set<number>()
  const lines: ShiftLine[] = []

  for (const pair of game.pairs) {
    if (active.has(pair.playerAId) && active.has(pair.playerBId)) {
      lines.push({ playerIds: [pair.playerAId, pair.playerBId], pairId: pair.id })
      used.add(pair.playerAId)
      used.add(pair.playerBId)
    }
  }

  const remainingIds = activeIds.filter((playerId) => !used.has(playerId))
  for (let index = 0; index + 1 < remainingIds.length; index += 2) {
    lines.push({ playerIds: [remainingIds[index], remainingIds[index + 1]], pairId: null })
  }

  return lines.length === 2 ? lines : null
}

function getShiftAssignments(game: GameState, shift: number): ShiftAssignments | null {
  const rosterSize = game.players.length
  if (rosterSize < PLAYERS_PER_SHIFT) return null

  const iceCycleLength = rosterSize / greatestCommonDivisor(rosterSize, PLAYERS_PER_SHIFT)
  const roleCycleLength = iceCycleLength * 2
  const linesByShift: ShiftLine[][] = []
  const orientations: boolean[] = []
  const roleDifference = new Map(game.players.map((player) => [player.id, 0]))

  for (let currentShift = 1; currentShift <= roleCycleLength; currentShift += 1) {
    const lines = getShiftLines(game, currentShift)
    if (!lines) return null
    linesByShift.push(lines)

    const orientationScore = (offenseLine: ShiftLine) => {
      const offenseIds = new Set(offenseLine.playerIds)
      return [...roleDifference].reduce((score, [playerId, difference]) => {
        const nextDifference = difference + (offenseIds.has(playerId) ? 1 : -1)
        return score + nextDifference ** 2
      }, 0)
    }
    const forwardScore = orientationScore(lines[0])
    const reverseScore = orientationScore(lines[1])
    const firstLineOnOffense = forwardScore < reverseScore
      || (forwardScore === reverseScore && currentShift % 2 === 1)
    orientations.push(firstLineOnOffense)

    const offenseLine = firstLineOnOffense ? lines[0] : lines[1]
    const defenseLine = firstLineOnOffense ? lines[1] : lines[0]
    for (const playerId of offenseLine.playerIds) {
      roleDifference.set(playerId, roleDifference.get(playerId)! + 1)
    }
    for (const playerId of defenseLine.playerIds) {
      roleDifference.set(playerId, roleDifference.get(playerId)! - 1)
    }
  }

  const calculateRoleDifference = () => {
    const differences = new Map(game.players.map((player) => [player.id, 0]))
    linesByShift.forEach((lines, index) => {
      const offenseLine = orientations[index] ? lines[0] : lines[1]
      const defenseLine = orientations[index] ? lines[1] : lines[0]
      for (const playerId of offenseLine.playerIds) differences.set(playerId, differences.get(playerId)! + 1)
      for (const playerId of defenseLine.playerIds) differences.set(playerId, differences.get(playerId)! - 1)
    })
    return differences
  }

  for (let iteration = 0; iteration < roleCycleLength * 2; iteration += 1) {
    const differences = calculateRoleDifference()
    const flipChanges = linesByShift.map((lines, index) => {
      const offenseLine = orientations[index] ? lines[0] : lines[1]
      const defenseLine = orientations[index] ? lines[1] : lines[0]
      const changes = new Map<number, number>()
      for (const playerId of offenseLine.playerIds) changes.set(playerId, -2)
      for (const playerId of defenseLine.playerIds) changes.set(playerId, 2)
      return changes
    })
    let bestShifts: number[] = []
    let bestImprovement = 0

    const considerFlips = (shiftIndexes: number[]) => {
      const combinedChanges = new Map<number, number>()
      for (const shiftIndex of shiftIndexes) {
        for (const [playerId, change] of flipChanges[shiftIndex]) {
          combinedChanges.set(playerId, (combinedChanges.get(playerId) ?? 0) + change)
        }
      }
      let improvement = 0
      for (const [playerId, change] of combinedChanges) {
        const difference = differences.get(playerId)!
        improvement += (difference ** 2) - ((difference + change) ** 2)
      }
      if (improvement > bestImprovement) {
        bestImprovement = improvement
        bestShifts = shiftIndexes
      }
    }

    for (let shiftIndex = 0; shiftIndex < roleCycleLength; shiftIndex += 1) {
      considerFlips([shiftIndex])
      for (let otherShift = shiftIndex + 1; otherShift < roleCycleLength; otherShift += 1) {
        considerFlips([shiftIndex, otherShift])
        for (let thirdShift = otherShift + 1; thirdShift < roleCycleLength; thirdShift += 1) {
          considerFlips([shiftIndex, otherShift, thirdShift])
        }
      }
    }

    if (bestShifts.length === 0) break
    for (const shiftIndex of bestShifts) orientations[shiftIndex] = !orientations[shiftIndex]
  }

  const targetIndex = (shift - 1) % roleCycleLength
  const targetLines = linesByShift[targetIndex]
  return orientations[targetIndex]
    ? { offense: targetLines[0], defense: targetLines[1] }
    : { offense: targetLines[1], defense: targetLines[0] }
}

function roleForPlayer(playerId: number, assignments: ShiftAssignments | null): string {
  if (assignments?.offense.playerIds.includes(playerId)) return 'OFFENSE'
  if (assignments?.defense.playerIds.includes(playerId)) return 'DEFENSE'
  return assignments ? 'REST' : 'PAIRING NEEDED'
}

function roleForPair(pair: Pair, assignments: ShiftAssignments | null): string {
  if (!assignments) return 'PAIRING NEEDED'
  if (assignments.offense.pairId === pair.id) return 'OFFENSE'
  if (assignments.defense.pairId === pair.id) return 'DEFENSE'
  const activeIds = [...assignments.offense.playerIds, ...assignments.defense.playerIds]
  return activeIds.some((playerId) => pair.playerAId === playerId || pair.playerBId === playerId)
    ? 'SPLIT'
    : 'REST'
}

function App() {
  const [game, setGame] = useState<GameState>(loadGame)
  const [editingRoster, setEditingRoster] = useState(false)
  const [wakeEnabled, setWakeEnabled] = useState(false)
  const [wakeRetry, setWakeRetry] = useState(0)
  const [wakeStatus, setWakeStatus] = useState<WakeStatus>('off')

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(game))
    } catch {
      // Local-file origins may not allow browser storage.
    }
  }, [game])

  useEffect(() => {
    if (!wakeEnabled) {
      setWakeStatus('off')
      return
    }

    const wakeLockApi = (navigator as NavigatorWithWakeLock).wakeLock
    if (!wakeLockApi) {
      setWakeStatus('unsupported')
      return
    }

    let sentinel: WakeLockSentinel | undefined
    let disposed = false

    const requestWakeLock = async () => {
      if (document.visibilityState !== 'visible') return

      try {
        const nextSentinel = await wakeLockApi.request('screen')
        if (disposed) {
          await nextSentinel.release()
          return
        }
        sentinel = nextSentinel
        nextSentinel.addEventListener('release', () => {
          if (!disposed) setWakeStatus('unavailable')
        })
        setWakeStatus('active')
      } catch {
        setWakeStatus('unavailable')
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void requestWakeLock()
    }

    void requestWakeLock()
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (sentinel) void sentinel.release()
    }
  }, [wakeEnabled, wakeRetry])

  const assignments = getShiftAssignments(game, game.shift)
  const pairedPlayerIds = new Set(game.pairs.flatMap((pair) => [pair.playerAId, pair.playerBId]))
  const allNamesEntered = game.players.length >= PLAYERS_PER_SHIFT
    && game.players.every((player) => player.name.trim().length > 0)
    && Boolean(game.goalieName.trim())
  const enteredNames = [...game.players.map((player) => player.name), game.goalieName]
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)
  const hasDuplicateNames = new Set(enteredNames).size !== enteredNames.length
  const canShuffle = allNamesEntered && !hasDuplicateNames

  function updatePlayer(playerId: number, value: string) {
    setGame((current) => ({
      ...current,
      players: current.players.map((player) => player.id === playerId ? { ...player, name: value } : player),
    }))
  }

  function updateGoalieName(value: string) {
    setGame((current) => ({ ...current, goalieName: value }))
  }

  function addSkater() {
    setGame((current) => {
      const playerId = Math.max(0, ...current.players.map((player) => player.id)) + 1
      return {
        ...current,
        players: [...current.players, { id: playerId, name: '' }],
        flexPlayerIds: current.pairs.length ? [...current.flexPlayerIds, playerId] : current.flexPlayerIds,
        shift: 1,
      }
    })
  }

  function removeSkater(playerId: number) {
    setGame((current) => {
      const players = current.players.filter((player) => player.id !== playerId)
      const brokenPairs = current.pairs.filter((pair) => pair.playerAId === playerId || pair.playerBId === playerId)
      const pairs = current.pairs.filter((pair) => pair.playerAId !== playerId && pair.playerBId !== playerId)
      const pairedIds = new Set(pairs.flatMap((pair) => [pair.playerAId, pair.playerBId]))
      const flexPlayerIds = [...new Set([
        ...current.flexPlayerIds.filter((id) => id !== playerId),
        ...brokenPairs.flatMap((pair) => [pair.playerAId, pair.playerBId]).filter((id) => id !== playerId),
      ])].filter((id) => players.some((player) => player.id === id) && !pairedIds.has(id))

      if (pairs.length) {
        for (const player of players) {
          if (!pairedIds.has(player.id) && !flexPlayerIds.includes(player.id)) flexPlayerIds.push(player.id)
        }
      }

      return { ...current, players, pairs, flexPlayerIds, shift: 1 }
    })
  }

  function shufflePairs() {
    if (!canShuffle) return

    const shuffled = [...game.players]
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1))
      const playerToSwap = shuffled[index]
      shuffled[index] = shuffled[swapIndex]
      shuffled[swapIndex] = playerToSwap
    }

    const pairs = Array.from({ length: Math.floor(shuffled.length / 2) }, (_, index) => ({
      id: index + 1,
      playerAId: shuffled[index * 2].id,
      playerBId: shuffled[index * 2 + 1].id,
    }))
    const flexPlayerIds = shuffled.length % 2 ? [shuffled[shuffled.length - 1].id] : []

    setGame((current) => ({ ...current, pairs, flexPlayerIds, shift: 1 }))
    setEditingRoster(false)
  }

  function resetGame() {
    if (window.confirm('Reset the game to shift 1? Your roster and pairs will stay saved.')) {
      setGame((current) => ({ ...current, shift: 1 }))
    }
  }

  function toggleWakeLock() {
    if (wakeEnabled) {
      if (wakeStatus === 'unavailable') setWakeRetry((retry) => retry + 1)
      else setWakeEnabled(false)
      return
    }
    setWakeEnabled(true)
  }

  const wakeLabel = wakeStatus === 'active'
    ? 'Screen awake'
    : wakeStatus === 'unsupported'
      ? 'Wake lock unavailable'
      : wakeStatus === 'unavailable'
        ? 'Retry wake lock'
        : 'Keep screen awake'

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="team-mark">
          <img src={oryaLogo} alt="" />
          <div>
            <p className="eyebrow">ORYA / 8U</p>
            <p className="team-name">BOBCATS</p>
          </div>
        </div>
        <div className="game-tag"><span className="live-dot" /> HALF ICE <b>4v4</b></div>
      </header>

      <div className="page-grid">
        <section className="bench-panel" aria-labelledby="bench-title">
          <div className="section-kicker">
            <span>BENCH BOARD</span>
            <span className="shift-number">SHIFT {String(game.shift).padStart(2, '0')}</span>
          </div>
          <div className="bench-heading">
            <div>
              <p className="eyebrow">CALL THESE LINES</p>
              <h1 id="bench-title">Next shift<span>.</span></h1>
            </div>
            <button
              className={`wake-button ${wakeStatus === 'active' ? 'is-awake' : ''}`}
              type="button"
              onClick={toggleWakeLock}
              aria-pressed={wakeStatus === 'active'}
              disabled={wakeStatus === 'unsupported'}
            >
              <span className="wake-icon" aria-hidden="true">{wakeStatus === 'active' ? '●' : '◉'}</span>
              <span>{wakeLabel}</span>
            </button>
          </div>

          <div className="assignments" aria-live="polite">
            <article className="assignment offense-assignment">
              <div className="assignment-topline">
                <span className="role-marker">01</span>
                <span className="role-label">OFFENSE</span>
                <span className="role-side">ATTACK</span>
              </div>
              <p className="pair-title">{lineName(assignments?.offense ?? null, game.players)}</p>
              <p className="pair-caption">Offense line</p>
            </article>
            <article className="assignment defense-assignment">
              <div className="assignment-topline">
                <span className="role-marker">02</span>
                <span className="role-label">DEFENSE</span>
                <span className="role-side">COVER</span>
              </div>
              <p className="pair-title">{lineName(assignments?.defense ?? null, game.players)}</p>
              <p className="pair-caption">Defense line</p>
            </article>
          </div>

          <div className="bench-actions">
            <button
              className="next-button"
              type="button"
              onClick={() => setGame((current) => ({ ...current, shift: current.shift + 1 }))}
              disabled={!assignments}
            >
              <span>Next shift</span>
              <span className="button-arrow" aria-hidden="true">→</span>
            </button>
            <button
              className="previous-button"
              type="button"
              onClick={() => setGame((current) => ({ ...current, shift: Math.max(1, current.shift - 1) }))}
              disabled={!assignments || game.shift === 1}
            >
              <span aria-hidden="true">←</span> Previous
            </button>
            <button className="reset-button" type="button" onClick={resetGame}>Reset game</button>
          </div>
          <p className="rotation-note">Lines rotate each shift <span>·</span> pairs stay together when possible</p>
        </section>

        <aside className="roster-panel" aria-labelledby="roster-title">
          <div className="roster-heading">
            <div>
              <p className="eyebrow">{game.players.length} SKATERS / 1 GOALIE</p>
              <h2 id="roster-title">Lineup</h2>
            </div>
            <button
              className="edit-button"
              type="button"
              onClick={() => setEditingRoster((editing) => !editing)}
              aria-expanded={editingRoster}
            >
              {editingRoster ? 'Done' : game.goalieName.trim() ? 'Edit roster' : 'Set roster'}
            </button>
          </div>

          {editingRoster ? (
            <div className="roster-editor">
              <label className="goalie-name-input">
                <span>GOALIE</span>
                <input
                  aria-label="Goalie name"
                  value={game.goalieName}
                  onChange={(event) => updateGoalieName(event.target.value)}
                  placeholder="Goalie name"
                  maxLength={24}
                />
              </label>
              <div className="player-editor-header"><span>SKATERS</span><span>{game.players.length}</span></div>
              <ol className="player-editor-list">
                {game.players.map((player) => (
                  <li className="player-editor-row" key={player.id}>
                    <span className="roster-index">{String(player.id).padStart(2, '0')}</span>
                    <label className="player-name-input">
                      <span className="sr-only">Player {player.id} name</span>
                      <input
                        value={player.name}
                        onChange={(event) => updatePlayer(player.id, event.target.value)}
                        placeholder={`Player ${player.id}`}
                        maxLength={24}
                      />
                    </label>
                    <button
                      className="remove-skater-button"
                      type="button"
                      onClick={() => removeSkater(player.id)}
                      disabled={game.players.length <= PLAYERS_PER_SHIFT}
                      aria-label={`Remove ${player.name || `player ${player.id}`}`}
                    >×</button>
                  </li>
                ))}
              </ol>
              <button className="add-skater-button" type="button" onClick={addSkater}>Add skater</button>
              <div className="roster-editor-actions">
                <button className="shuffle-button" type="button" onClick={shufflePairs} disabled={!canShuffle}>
                  Shuffle pairs
                </button>
                <p className="roster-helper" aria-live="polite">
                  {game.players.length < PLAYERS_PER_SHIFT
                    ? `At least ${PLAYERS_PER_SHIFT} skaters are needed for 4v4.`
                    : !allNamesEntered
                      ? 'Enter every skater name and the goalie name.'
                    : hasDuplicateNames
                      ? 'Each skater and the goalie need unique names.'
                      : `${game.players.length} skaters ready; ${game.players.length % 2 ? 'one extra rotates through the lines.' : 'all skaters will be paired.'}`}
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="goalie-banner">
                <span className="goalie-badge">G</span>
                <span className="goalie-name">
                  <strong>{game.goalieName || 'Goalie not set'}</strong>
                  <small>GOALIE</small>
                </span>
              </div>
              <ol className="roster-list">
                {game.pairs.map((pair) => {
                  const role = roleForPair(pair, assignments)
                  const roleClass = role.toLowerCase().replace(/ /g, '-')
                  const pairLine: ShiftLine = { playerIds: [pair.playerAId, pair.playerBId], pairId: pair.id }
                  return (
                    <li className="roster-row" key={pair.id}>
                      <span className="roster-index">{String(pair.id).padStart(2, '0')}</span>
                      <span className="roster-name">
                        <strong>{lineName(pairLine, game.players)}</strong>
                        <small>PAIR</small>
                      </span>
                      <span className={`roster-status ${roleClass}`}>{role}</span>
                    </li>
                  )
                })}
                {game.players.filter((player) => !pairedPlayerIds.has(player.id)).map((player) => {
                  const role = roleForPlayer(player.id, assignments)
                  const roleClass = role.toLowerCase().replace(/ /g, '-')
                  return (
                    <li className="roster-row" key={player.id}>
                      <span className="roster-index">{String(player.id).padStart(2, '0')}</span>
                      <span className="roster-name">
                        <strong>{player.name || `Player ${player.id}`}</strong>
                        <small>{game.flexPlayerIds.includes(player.id) ? 'ROTATING SKATER' : 'PAIRING NEEDED'}</small>
                      </span>
                      <span className={`roster-status ${roleClass}`}>{role}</span>
                    </li>
                  )
                })}
              </ol>
            </>
          )}

          <div className="roster-footer">
            <span className="ice-key"><i className="key-offense" /> Offense</span>
            <span className="ice-key"><i className="key-defense" /> Defense</span>
            <span className="ice-key"><i className="key-rest" /> Rest</span>
          </div>
        </aside>
      </div>
      <footer className="app-footer">
        <span>ORYA BOBCATS</span>
        <span>BUILT FOR THE BENCH <i>✳</i></span>
      </footer>
    </main>
  )
}

export default App
