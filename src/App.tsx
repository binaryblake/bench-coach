import { useEffect, useState, type FormEvent } from 'react'
import oryaLogo from '../orya-logo.png'
import './App.css'

const STORAGE_KEY = 'orya-bench-coach'
const DEFAULT_SKATER_COUNT = 10
const PLAYERS_PER_SHIFT = 4
const FULL_ICE_PERIOD_COUNT = 3
const FORWARD_LINE_SIZE = 3
const DEFENSE_PAIR_SIZE = 2

type GameMode = '4v4' | '5v5'

type PeriodLineup = {
  forwardPlayerIds: number[]
  defensePlayerIds: number[]
}

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

type LineupOption = {
  id: string
  pairs: Pair[]
  flexPlayerIds: number[]
  goalieName: string
  playerNames?: Record<string, string>
}

type ScheduledGame = {
  id: string
  date: string
  title: string
  players: Player[]
  goalieName: string
  lineups: LineupOption[]
  selectedLineupId: string | null
  playedLineup: LineupOption | null
  goldenBobcatPlayerName: string | null
  playedGoldenBobcatPlayerName: string | null
  mode: GameMode
  periodLineups: PeriodLineup[]
  playedMode: GameMode | null
  playedPeriodLineups: PeriodLineup[] | null
  playedPeriodPlayerNames: Record<string, string> | null
  playedGoalieName: string | null
}

type SavedPair = {
  id?: number
  playerAId?: number | null
  playerBId?: number | null
  playerA?: string
  playerB?: string
}

type SavedGame = {
  game?: SavedGame
  players?: Array<Partial<Player>>
  goalieName?: string
  goalieId?: number | null
  pairs?: SavedPair[]
  flexPlayerIds?: number[]
  shift?: number
  scheduledGames?: ScheduledGame[]
  games?: ScheduledGame[]
  activeGameId?: string | null
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

function emptyPeriodLineup(): PeriodLineup {
  return { forwardPlayerIds: [], defensePlayerIds: [] }
}

function clonePeriodLineups(periods: PeriodLineup[]): PeriodLineup[] {
  return periods.map((period) => ({
    forwardPlayerIds: [...period.forwardPlayerIds],
    defensePlayerIds: [...period.defensePlayerIds],
  }))
}

function normalizePeriodLineups(value: unknown, players: Player[]): PeriodLineup[] {
  if (!Array.isArray(value) || value.length === 0) return []
  const playerIds = new Set(players.filter((player) => player.name.trim()).map((player) => player.id))
  const savedPeriods = value as Partial<PeriodLineup>[]
  return Array.from({ length: FULL_ICE_PERIOD_COUNT }, (_, periodIndex) => {
    const saved = savedPeriods[periodIndex]
    const normalizeIds = (slots: unknown) => {
      if (!Array.isArray(slots)) return []
      const seen = new Set<number>()
      return slots.filter((playerId): playerId is number => {
        if (typeof playerId !== 'number' || !Number.isInteger(playerId) || !playerIds.has(playerId) || seen.has(playerId)) {
          return false
        }
        seen.add(playerId)
        return true
      })
    }
    const forwardPlayerIds = normalizeIds(saved?.forwardPlayerIds)
    const forwardIds = new Set(forwardPlayerIds)
    return {
      forwardPlayerIds,
      defensePlayerIds: normalizeIds(saved?.defensePlayerIds).filter((playerId) => !forwardIds.has(playerId)),
    }
  })
}

function generateBalancedPeriodLineups(players: Player[]): PeriodLineup[] {
  const roster = players.filter((player) => player.name.trim())
  const defenseAppearances = new Map(roster.map((player) => [player.id, 0]))
  const rosterOrder = new Map(roster.map((player, index) => [player.id, index]))
  const pairAppearances = new Map<string, number>()
  const balancedDefenseCount = roster.length > 1
    ? Math.max(1, Math.min(roster.length - 1, Math.round(roster.length * 2 / 5)))
    : 0
  const balancedForwardCount = roster.length - balancedDefenseCount
  const defenseCount = balancedDefenseCount === 4 && balancedForwardCount % 2 === 1
    ? 3
    : balancedDefenseCount

  return Array.from({ length: FULL_ICE_PERIOD_COUNT }, (_, periodIndex) => {
    const rotatedOrder = (player: Player) =>
      ((rosterOrder.get(player.id) ?? 0) + periodIndex) % Math.max(roster.length, 1)
    const defense = [...roster]
      .sort((left, right) =>
        (defenseAppearances.get(left.id) ?? 0) - (defenseAppearances.get(right.id) ?? 0)
        || rotatedOrder(left) - rotatedOrder(right),
      )
      .slice(0, defenseCount)
      .sort((left, right) => rotatedOrder(left) - rotatedOrder(right))
    const defenseIds = new Set(defense.map((player) => player.id))
    const forwardPlayers = roster
      .filter((player) => !defenseIds.has(player.id))
      .map((player) => player.id)
    const orderedForwardIds = orderPlayersIntoBalancedGroups(
      forwardPlayers,
      FORWARD_LINE_SIZE,
      periodIndex,
      rosterOrder,
      roster.length,
      pairAppearances,
    )
    const orderedDefenseIds = orderPlayersIntoBalancedGroups(
      defense.map((player) => player.id),
      DEFENSE_PAIR_SIZE,
      periodIndex,
      rosterOrder,
      roster.length,
      pairAppearances,
    )

    for (const player of defense) defenseAppearances.set(player.id, (defenseAppearances.get(player.id) ?? 0) + 1)

    return {
      forwardPlayerIds: orderedForwardIds,
      defensePlayerIds: orderedDefenseIds,
    }
  })
}

function normalizeRecordedPeriodLineups(value: unknown): PeriodLineup[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const savedPeriods = value as Partial<PeriodLineup>[]
  return Array.from({ length: FULL_ICE_PERIOD_COUNT }, (_, periodIndex) => {
    const saved = savedPeriods[periodIndex]
    const normalizeIds = (slots: unknown) => {
      if (!Array.isArray(slots)) return []
      const seen = new Set<number>()
      return slots.filter((playerId): playerId is number => {
        if (typeof playerId !== 'number' || !Number.isInteger(playerId) || playerId <= 0 || seen.has(playerId)) {
          return false
        }
        seen.add(playerId)
        return true
      })
    }
    const forwardPlayerIds = normalizeIds(saved?.forwardPlayerIds)
    const forwardIds = new Set(forwardPlayerIds)
    return {
      forwardPlayerIds,
      defensePlayerIds: normalizeIds(saved?.defensePlayerIds).filter((playerId) => !forwardIds.has(playerId)),
    }
  })
}

function splitIntoGroups(playerIds: number[], groupSize: number): number[][] {
  const sizes: number[] = []
  let remaining = playerIds.length
  while (remaining > 0) {
    const nextSize = Math.min(groupSize, remaining)
    sizes.push(nextSize)
    remaining -= nextSize
    if (remaining === 1 && sizes.length > 0) {
      sizes[sizes.length - 1] += 1
      remaining = 0
    }
  }
  const groups: number[][] = []
  let startIndex = 0
  for (const size of sizes) {
    groups.push(playerIds.slice(startIndex, startIndex + size))
    startIndex += size
  }
  return groups
}

function getShiftPlayerIds(playerIds: number[], playersPerShift: number, shiftIndex: number): number[] {
  if (!playerIds.length) return []
  const count = Math.min(playersPerShift, playerIds.length)
  const startIndex = (shiftIndex * playersPerShift) % playerIds.length
  return Array.from({ length: count }, (_, index) => playerIds[(startIndex + index) % playerIds.length])
}

function getFullIceShiftLineup(period: PeriodLineup, shiftIndex: number): PeriodLineup {
  return {
    forwardPlayerIds: getShiftPlayerIds(period.forwardPlayerIds, FORWARD_LINE_SIZE, shiftIndex),
    defensePlayerIds: getShiftPlayerIds(period.defensePlayerIds, DEFENSE_PAIR_SIZE, shiftIndex),
  }
}

function getDoubleShiftPlayerIds(current: PeriodLineup, next: PeriodLineup): Set<number> {
  const nextShiftPlayerIds = new Set([...next.forwardPlayerIds, ...next.defensePlayerIds])
  return new Set(
    [...current.forwardPlayerIds, ...current.defensePlayerIds]
      .filter((playerId) => nextShiftPlayerIds.has(playerId)),
  )
}

function orderPlayersIntoBalancedGroups(
  playerIds: number[],
  groupSize: number,
  periodIndex: number,
  rosterOrder: Map<number, number>,
  rosterLength: number,
  pairAppearances: Map<string, number>,
): number[] {
  const ordered: number[] = []
  const pairKey = (first: number, second: number) =>
    first < second ? `${first}:${second}` : `${second}:${first}`
  const rotationRank = (playerId: number) =>
    ((rosterOrder.get(playerId) ?? 0) + periodIndex) % Math.max(rosterLength, 1)
  const partnerCount = (playerId: number) =>
    [...pairAppearances.entries()]
      .filter(([key]) => key.split(':').includes(String(playerId)))
      .reduce((sum, [, count]) => sum + count, 0)
  const remaining = new Set(playerIds)

  for (const size of splitIntoGroups(playerIds, groupSize).map((group) => group.length)) {
    const group: number[] = []
    while (group.length < size) {
      const candidates = [...remaining].sort((left, right) => {
        const leftGroupRepeats = group.reduce((sum, id) => sum + (pairAppearances.get(pairKey(left, id)) ?? 0), 0)
        const rightGroupRepeats = group.reduce((sum, id) => sum + (pairAppearances.get(pairKey(right, id)) ?? 0), 0)
        return leftGroupRepeats - rightGroupRepeats
          || partnerCount(left) - partnerCount(right)
          || rotationRank(left) - rotationRank(right)
      })
      const nextPlayer = candidates[0]
      if (nextPlayer === undefined) break
      group.push(nextPlayer)
      remaining.delete(nextPlayer)
    }
    for (let firstIndex = 0; firstIndex < group.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < group.length; secondIndex += 1) {
        const key = pairKey(group[firstIndex], group[secondIndex])
        pairAppearances.set(key, (pairAppearances.get(key) ?? 0) + 1)
      }
    }
    ordered.push(...group)
  }

  return ordered
}

function normalizePlayers(value: unknown): Player[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return []
    const player = item as Partial<Player>
    return [{
      id: Number.isInteger(player.id) && player.id! > 0 ? player.id! : index + 1,
      name: typeof player.name === 'string' ? player.name : '',
    }]
  })
}

function loadGame(): GameState {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const savedState = JSON.parse(saved) as SavedGame
      const parsed = savedState.game ?? savedState
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

function loadScheduledGames(): ScheduledGame[] {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (!saved) return []
    const parsed = JSON.parse(saved) as SavedGame
    const games = parsed.scheduledGames ?? parsed.games
    if (!Array.isArray(games)) return []
    const fallbackGame = parsed.game ?? parsed
    const fallbackPlayers = normalizePlayers(fallbackGame.players)
    return games.filter((game) =>
      typeof game.id === 'string'
      && typeof game.date === 'string'
      && typeof game.title === 'string'
      && Array.isArray(game.lineups),
    ).map((game) => {
      const selectedLineup = game.lineups.find((lineup) => lineup.id === game.selectedLineupId)
      const savedNames = Object.keys(game.playedLineup?.playerNames ?? {}).length
        ? game.playedLineup?.playerNames
        : selectedLineup?.playerNames
      const lineupPlayers = savedNames
        ? Object.entries(savedNames).map(([id, name]) => ({ id: Number(id), name }))
          .filter((player) => Number.isInteger(player.id) && typeof player.name === 'string')
          .sort((left, right) => left.id - right.id)
        : []
      const players = normalizePlayers(game.players)
      const rosterPlayers = players.length ? players : lineupPlayers.length ? lineupPlayers : fallbackPlayers
      const savedMode: GameMode = game.mode === '5v5' ? '5v5' : '4v4'
      const savedPeriods = normalizePeriodLineups(game.periodLineups, rosterPlayers)
      const savedPlayedPeriods = normalizeRecordedPeriodLineups(game.playedPeriodLineups)
      return {
        ...game,
        players: rosterPlayers,
        goalieName: typeof game.goalieName === 'string'
          ? game.goalieName
          : selectedLineup?.goalieName ?? game.playedLineup?.goalieName ?? fallbackGame.goalieName ?? '',
        goldenBobcatPlayerName: typeof game.goldenBobcatPlayerName === 'string'
          ? game.goldenBobcatPlayerName
          : typeof game.playedGoldenBobcatPlayerName === 'string'
            ? game.playedGoldenBobcatPlayerName
            : null,
        playedGoldenBobcatPlayerName: typeof game.playedGoldenBobcatPlayerName === 'string'
          ? game.playedGoldenBobcatPlayerName
          : typeof game.goldenBobcatPlayerName === 'string'
            ? game.goldenBobcatPlayerName
            : null,
        mode: savedMode,
        periodLineups: savedMode === '5v5' && !hasCompletePeriodRotation(savedPeriods, rosterPlayers)
          ? generateBalancedPeriodLineups(rosterPlayers)
          : savedPeriods,
        playedMode: game.playedMode === '5v5' || game.playedMode === '4v4'
          ? game.playedMode
          : savedPlayedPeriods ? '5v5' : game.playedLineup ? '4v4' : null,
        playedPeriodLineups: savedPlayedPeriods,
        playedPeriodPlayerNames: game.playedPeriodPlayerNames ?? null,
        playedGoalieName: typeof game.playedGoalieName === 'string'
          ? game.playedGoalieName
          : game.playedLineup?.goalieName ?? null,
      }
    })
  } catch {
    return []
  }
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function localDateTimeString(date: Date): string {
  const two = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`
}

function parseCalendarDate(value: string, timezone?: string): string {
  const date = value.trim()
  const dateOnly = date.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (dateOnly) return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`
  const dateTime = date.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/)
  if (!dateTime) return ''

  if (dateTime[7]) {
    const utc = new Date(Date.UTC(
      Number(dateTime[1]), Number(dateTime[2]) - 1, Number(dateTime[3]),
      Number(dateTime[4]), Number(dateTime[5]), Number(dateTime[6] ?? 0),
    ))
    return localDateTimeString(utc)
  }
  if (timezone) {
    try {
      const desired = Date.UTC(
        Number(dateTime[1]), Number(dateTime[2]) - 1, Number(dateTime[3]),
        Number(dateTime[4]), Number(dateTime[5]), Number(dateTime[6] ?? 0),
      )
      let instant = desired
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      })
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, Number(part.value)]))
        const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
        instant += desired - represented
      }
      return localDateTimeString(new Date(instant))
    } catch {
      // Fall back to the calendar's floating local time for an unknown TZID.
    }
  }
  return `${dateTime[1]}-${dateTime[2]}-${dateTime[3]}T${dateTime[4]}:${dateTime[5]}`
}

function unescapeCalendarText(value: string): string {
  return value.replace(/\\[nN]/g, ' ').replace(/\\([,;\\])/g, '$1').trim()
}

function formatGameDate(value: string): string {
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: value.length > 10 ? 'short' : undefined }).format(date)
}

function parseCalendarEvents(contents: string): Array<{ date: string; title: string }> {
  const unfolded = contents.replace(/\r?\n[ \t]/g, '')
  const events: Array<{ date: string; title: string }> = []
  let event: { date?: string; title?: string } | null = null

  for (const line of unfolded.split(/\r?\n/)) {
    if (line === 'BEGIN:VEVENT') {
      event = {}
    } else if (line === 'END:VEVENT' && event) {
      if (event.date) events.push({ date: event.date, title: event.title || 'Game' })
      event = null
    } else if (event) {
      const property = line.match(/^(DTSTART(?:;[^:]*)?):(.*)$/i)
      if (property) {
        const timezone = property[1].match(/(?:^|;)TZID=([^;:]*)/i)?.[1].replace(/^"|"$/g, '')
        event.date = parseCalendarDate(property[2], timezone)
      }
      const summary = line.match(/^SUMMARY(?:;[^:]*)?:(.*)$/i)
      if (summary) event.title = unescapeCalendarText(summary[1])
    }
  }

  return events
}

function isPracticeTitle(title: string): boolean {
  return /\bpracti[cs]e?s?\b|\bskills?\b|\bpre[\s-]?season\s+ice\b/i.test(title)
}

function pairKey(firstName: string, secondName: string): string {
  return JSON.stringify([firstName.trim().toLowerCase(), secondName.trim().toLowerCase()].sort())
}

function addKnownName(names: Map<string, string>, value: string | null | undefined): void {
  const name = value?.trim()
  if (!name) return
  const key = name.toLowerCase()
  if (!names.has(key)) names.set(key, name)
}

type PairHistoryCount = {
  count: number
  names: [string, string]
}

function countPastPairs(games: ScheduledGame[]): Map<string, PairHistoryCount> {
  const counts = new Map<string, PairHistoryCount>()
  const addPair = (firstName: string, secondName: string) => {
    if (!firstName.trim() || !secondName.trim()) return
    const names = firstName.toLowerCase() <= secondName.toLowerCase()
      ? [firstName, secondName] as [string, string]
      : [secondName, firstName] as [string, string]
    const key = pairKey(firstName, secondName)
    const stats = counts.get(key)
    counts.set(key, { count: (stats?.count ?? 0) + 1, names: stats?.names ?? names })
  }

  for (const game of games) {
    if (isPracticeTitle(game.title)) continue
    if (game.playedMode === '5v5' && game.playedPeriodLineups) {
      const gamePairs = new Map<string, [string, string]>()
      for (const period of game.playedPeriodLineups) {
        const groups = [
          ...splitIntoGroups(period.forwardPlayerIds, FORWARD_LINE_SIZE),
          ...splitIntoGroups(period.defensePlayerIds, DEFENSE_PAIR_SIZE),
        ]
        for (const group of groups) {
          const names = group.flatMap((playerId) => {
            const name = game.playedPeriodPlayerNames?.[String(playerId)]
              ?? game.players.find((player) => player.id === playerId)?.name
              ?? ''
            return name.trim() ? [name] : []
          })
          for (let firstIndex = 0; firstIndex < names.length; firstIndex += 1) {
            for (let secondIndex = firstIndex + 1; secondIndex < names.length; secondIndex += 1) {
              const first = names[firstIndex]
              const second = names[secondIndex]
              gamePairs.set(pairKey(first, second), [first, second])
            }
          }
        }
      }
      for (const [first, second] of gamePairs.values()) addPair(first, second)
      continue
    }

    const lineup = game.playedLineup
    for (const pair of lineup?.pairs ?? []) {
      const firstName = lineup?.playerNames?.[String(pair.playerAId)]
        ?? game.players.find((player) => player.id === pair.playerAId)?.name
        ?? ''
      const secondName = lineup?.playerNames?.[String(pair.playerBId)]
        ?? game.players.find((player) => player.id === pair.playerBId)?.name
        ?? ''
      addPair(firstName, secondName)
    }
  }
  return counts
}

function lineupPairSummary(lineup: LineupOption, players: Player[]): string {
  const playerName = (playerId: number) =>
    lineup.playerNames?.[String(playerId)]
    || players.find((player) => player.id === playerId)?.name
    || `Player ${playerId}`
  return lineup.pairs.map((pair) => `${playerName(pair.playerAId)}/${playerName(pair.playerBId)}`).join(' · ')
}

function sameLineupDetails(left: LineupOption, right: LineupOption): boolean {
  const leftNames = Object.entries(left.playerNames ?? {}).sort(([first], [second]) => first.localeCompare(second))
  const rightNames = Object.entries(right.playerNames ?? {}).sort(([first], [second]) => first.localeCompare(second))
  return left.goalieName === right.goalieName
    && JSON.stringify(left.pairs) === JSON.stringify(right.pairs)
    && JSON.stringify(left.flexPlayerIds) === JSON.stringify(right.flexPlayerIds)
    && JSON.stringify(leftNames) === JSON.stringify(rightNames)
}

function playerNameSnapshot(players: Player[]): Record<string, string> {
  return Object.fromEntries(players.map((player) => [String(player.id), player.name]))
}

function samePeriodLineups(
  current: PeriodLineup[],
  recorded: PeriodLineup[] | null,
  players: Player[],
  recordedPlayerNames: Record<string, string> | null,
): boolean {
  if (!recorded || !recordedPlayerNames) return false
  const sortNames = (names: Record<string, string>) =>
    Object.entries(names).sort(([first], [second]) => first.localeCompare(second))
  return JSON.stringify(current) === JSON.stringify(recorded)
    && JSON.stringify(sortNames(playerNameSnapshot(players))) === JSON.stringify(sortNames(recordedPlayerNames))
}

function hasFullIceShiftPositions(periods: PeriodLineup[]): boolean {
  return periods.length === FULL_ICE_PERIOD_COUNT && periods.every((period) =>
    period.defensePlayerIds.length >= DEFENSE_PAIR_SIZE
    && period.forwardPlayerIds.length >= FORWARD_LINE_SIZE,
  )
}

function hasCompletePeriodRotation(periods: PeriodLineup[], players: Player[]): boolean {
  if (periods.length !== FULL_ICE_PERIOD_COUNT) return false
  const rosterIds = players.filter((player) => player.name.trim()).map((player) => player.id)
  if (rosterIds.length < 5 || !hasFullIceShiftPositions(periods)) return false
  return periods.every((period) => {
    const assigned = [...period.defensePlayerIds, ...period.forwardPlayerIds]
    return assigned.length === rosterIds.length
      && new Set(assigned).size === rosterIds.length
      && rosterIds.every((playerId) => assigned.includes(playerId))
  })
}

function periodPlayerNames(
  playerIds: number[],
  players: Player[],
  nameSnapshot?: Record<string, string> | null,
): string {
  return playerIds.map((playerId) => {
    const savedName = nameSnapshot?.[String(playerId)]?.trim()
    const currentName = players.find((player) => player.id === playerId)?.name.trim()
    return savedName || currentName || `Player ${playerId}`
  }).join(' · ')
}

function periodLineupSummary(
  period: PeriodLineup,
  players: Player[],
  nameSnapshot?: Record<string, string> | null,
): string {
  const forwardSummary = (playerIds: number[]) =>
    splitIntoGroups(playerIds, FORWARD_LINE_SIZE)
      .map((group, index) => `Line ${index + 1}: ${periodPlayerNames(group, players, nameSnapshot)}`)
      .join(' · ')
  const defenseSummary = splitIntoGroups(period.defensePlayerIds, DEFENSE_PAIR_SIZE)
    .map((group, index) => `${group.length === DEFENSE_PAIR_SIZE ? 'Pair' : 'Group'} ${index + 1}: ${periodPlayerNames(group, players, nameSnapshot)}`)
    .join(' · ')
  return `Forwards · ${forwardSummary(period.forwardPlayerIds) || 'No players'} · Defense · ${defenseSummary || 'No players'}`
}

function needsGameRerecord(scheduledGame: ScheduledGame): boolean {
  const hasRecordedSnapshot = scheduledGame.playedMode !== null
    || Boolean(scheduledGame.playedLineup)
    || Boolean(scheduledGame.playedGoldenBobcatPlayerName)
  if (!hasRecordedSnapshot) return false
  const modeChanged = scheduledGame.playedMode !== null && scheduledGame.mode !== scheduledGame.playedMode
  const selectedLineup = scheduledGame.lineups.find((lineup) => lineup.id === scheduledGame.selectedLineupId)
  const lineupChanged = scheduledGame.mode === '5v5'
    ? scheduledGame.playedMode === '5v5'
      ? !samePeriodLineups(
        scheduledGame.periodLineups,
        scheduledGame.playedPeriodLineups,
        scheduledGame.players,
        scheduledGame.playedPeriodPlayerNames,
      )
      : Boolean(selectedLineup)
    : scheduledGame.playedLineup
      ? !selectedLineup || !sameLineupDetails(selectedLineup, scheduledGame.playedLineup)
      : Boolean(selectedLineup)
  const goalieChanged = scheduledGame.playedMode !== null
    && scheduledGame.goalieName !== (scheduledGame.playedGoalieName ?? '')
  return modeChanged
    || lineupChanged
    || goalieChanged
    || scheduledGame.goldenBobcatPlayerName !== scheduledGame.playedGoldenBobcatPlayerName
}

function createBalancedPairing(players: Player[], history: Map<string, number>): { pairs: Pair[]; flexPlayerIds: number[] } {
  let best: Player[] = [...players]
  let bestScore = Number.POSITIVE_INFINITY
  const attempts = Math.min(500, Math.max(100, players.length * players.length * 5))

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const shuffled = [...players]
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1))
      ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]
    }
    let score = 0
    for (let index = 0; index + 1 < shuffled.length; index += 2) {
      const count = history.get(pairKey(shuffled[index].name, shuffled[index + 1].name)) ?? 0
      score += (count + 1) ** 2
    }
    score += Math.random() * 0.001
    if (score < bestScore) {
      best = shuffled
      bestScore = score
    }
  }

  return {
    pairs: Array.from({ length: Math.floor(best.length / 2) }, (_, index) => ({
      id: index + 1,
      playerAId: best[index * 2].id,
      playerBId: best[index * 2 + 1].id,
    })),
    flexPlayerIds: best.length % 2 ? [best[best.length - 1].id] : [],
  }
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
  const [scheduledGames, setScheduledGames] = useState<ScheduledGame[]>(loadScheduledGames)
  const [activeGameId, setActiveGameId] = useState<string | null>(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY)
      const id = saved ? (JSON.parse(saved) as SavedGame).activeGameId : null
      return typeof id === 'string' && loadScheduledGames().some((item) => item.id === id) ? id : null
    } catch {
      return null
    }
  })
  const [view, setView] = useState<'bench' | 'schedule' | 'analytics'>('bench')
  const [currentPeriodIndex, setCurrentPeriodIndex] = useState(0)
  const [currentFullIceShiftIndex, setCurrentFullIceShiftIndex] = useState(0)
  const [editingRoster, setEditingRoster] = useState(false)
  const [manualPairingOpen, setManualPairingOpen] = useState(false)
  const [manualPairingIds, setManualPairingIds] = useState<Record<number, number>>({})
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle')
  const [calendarMessage, setCalendarMessage] = useState('')
  const [calendarUrl, setCalendarUrl] = useState('')
  const [isImportingCalendar, setIsImportingCalendar] = useState(false)
  const [scheduleTitle, setScheduleTitle] = useState('')
  const [scheduleMessage, setScheduleMessage] = useState('')
  const [scheduleDate, setScheduleDate] = useState(() => {
    const now = new Date()
    const two = (part: number) => String(part).padStart(2, '0')
    return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}T${two(now.getHours())}:${two(now.getMinutes())}`
  })
  const [wakeEnabled, setWakeEnabled] = useState(false)
  const [wakeRetry, setWakeRetry] = useState(0)
  const [wakeStatus, setWakeStatus] = useState<WakeStatus>('off')

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ game, scheduledGames, activeGameId }))
    } catch {
      // Local-file origins may not allow browser storage.
    }
  }, [game, scheduledGames, activeGameId])

  useEffect(() => {
    if (!activeGameId) return
    setScheduledGames((currentGames) => currentGames.map((scheduledGame) => {
      if (scheduledGame.id !== activeGameId) return scheduledGame
      const players = game.players.map((player) => ({ ...player }))
      const rosterChanged = JSON.stringify(scheduledGame.players) !== JSON.stringify(players)
        || scheduledGame.goalieName !== game.goalieName
      const rosterIds = (roster: Player[]) => roster
        .filter((player) => player.name.trim())
        .map((player) => player.id)
        .sort((left, right) => left - right)
      const rosterMembershipChanged = JSON.stringify(rosterIds(scheduledGame.players)) !== JSON.stringify(rosterIds(players))
      const activeRosterIds = new Set(rosterIds(players))
      const periodLineups = scheduledGame.mode === '5v5' && rosterMembershipChanged
        ? generateBalancedPeriodLineups(players)
        : scheduledGame.periodLineups.map((period) => ({
          forwardPlayerIds: period.forwardPlayerIds.filter((playerId) => activeRosterIds.has(playerId)),
          defensePlayerIds: period.defensePlayerIds.filter((playerId) => activeRosterIds.has(playerId)),
        }))
      const periodsChanged = JSON.stringify(scheduledGame.periodLineups) !== JSON.stringify(periodLineups)
      if (!scheduledGame.selectedLineupId && !game.pairs.length) {
        return rosterChanged || periodsChanged
          ? { ...scheduledGame, players, goalieName: game.goalieName, periodLineups }
          : scheduledGame
      }
      const selectedId = scheduledGame.selectedLineupId ?? createId('lineup')
      const currentLineup: LineupOption = {
        id: selectedId,
        pairs: game.pairs.map((pair) => ({ ...pair })),
        flexPlayerIds: [...game.flexPlayerIds],
        goalieName: game.goalieName,
        playerNames: Object.fromEntries(game.players.map((player) => [String(player.id), player.name])),
      }
      const existing = scheduledGame.lineups.some((lineup) => lineup.id === selectedId)
      const lineups = existing
        ? scheduledGame.lineups.map((lineup) => lineup.id === selectedId ? currentLineup : lineup)
        : [...scheduledGame.lineups, currentLineup]
      if (scheduledGame.selectedLineupId === selectedId
        && !rosterChanged
        && !periodsChanged
        && JSON.stringify(scheduledGame.lineups) === JSON.stringify(lineups)) return scheduledGame
      return {
        ...scheduledGame,
        players,
        goalieName: game.goalieName,
        lineups,
        selectedLineupId: selectedId,
        periodLineups,
      }
    }))
  }, [game, activeGameId])

  useEffect(() => {
    if (activeGameId && scheduledGames.some((item) => item.id === activeGameId && isPracticeTitle(item.title))) {
      setActiveGameId(null)
    }
  }, [activeGameId, scheduledGames])

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
  const visibleScheduledGames = scheduledGames.filter((item) => !isPracticeTitle(item.title))
  const activeScheduledGame = visibleScheduledGames.find((item) => item.id === activeGameId) ?? null
  const activeGameMode = activeScheduledGame?.mode ?? '4v4'
  const isFullIce = activeGameMode === '5v5'
  const currentPeriodLineup = activeScheduledGame?.periodLineups[currentPeriodIndex] ?? emptyPeriodLineup()
  const currentFullIceShiftLineup = getFullIceShiftLineup(currentPeriodLineup, currentFullIceShiftIndex)
  const nextFullIceShiftLineup = getFullIceShiftLineup(currentPeriodLineup, currentFullIceShiftIndex + 1)
  const doubleShiftPlayerIds = getDoubleShiftPlayerIds(currentFullIceShiftLineup, nextFullIceShiftLineup)
  const namedSkaters = game.players.filter((player) => player.name.trim())
  const currentForwardGroups = splitIntoGroups(currentPeriodLineup.forwardPlayerIds, FORWARD_LINE_SIZE)
  const currentDefenseGroups = splitIntoGroups(currentPeriodLineup.defensePlayerIds, DEFENSE_PAIR_SIZE)
  const hasRecordedGame = Boolean(activeScheduledGame && (
    activeScheduledGame.playedMode !== null
    || activeScheduledGame.playedLineup
  ))
  const activeNeedsRerecord = activeScheduledGame ? needsGameRerecord(activeScheduledGame) : false
  const playedGames = scheduledGames.filter((item) =>
    !isPracticeTitle(item.title)
    && (item.playedMode === '5v5' ? Boolean(item.playedPeriodLineups) : Boolean(item.playedLineup)),
  )
  const pairCounts = countPastPairs(scheduledGames)
  const knownSkaters = new Map<string, string>()
  const goalieCandidates = new Map<string, string>()
  const goldenBobcatCandidates = new Map<string, string>()
  for (const player of game.players) addKnownName(knownSkaters, player.name)
  addKnownName(goalieCandidates, game.goalieName)
  for (const scheduledGame of visibleScheduledGames) {
    for (const player of scheduledGame.players) addKnownName(knownSkaters, player.name)
    for (const lineup of [...scheduledGame.lineups, ...(scheduledGame.playedLineup ? [scheduledGame.playedLineup] : [])]) {
      for (const name of Object.values(lineup.playerNames ?? {})) addKnownName(knownSkaters, name)
      addKnownName(goalieCandidates, lineup.goalieName)
    }
    for (const name of Object.values(scheduledGame.playedPeriodPlayerNames ?? {})) addKnownName(knownSkaters, name)
    addKnownName(goalieCandidates, scheduledGame.goalieName)
    addKnownName(goalieCandidates, scheduledGame.playedGoalieName)
    addKnownName(goldenBobcatCandidates, scheduledGame.goldenBobcatPlayerName)
    addKnownName(goldenBobcatCandidates, scheduledGame.playedGoldenBobcatPlayerName)
  }
  for (const name of knownSkaters.values()) {
    addKnownName(goalieCandidates, name)
    addKnownName(goldenBobcatCandidates, name)
  }
  for (const name of goalieCandidates.values()) addKnownName(goldenBobcatCandidates, name)

  const allKnownSkaterNames = [...knownSkaters.values()].sort((first, second) => first.localeCompare(second))
  const pairStats: { key: string; count: number; label: string }[] = []
  for (let firstIndex = 0; firstIndex < allKnownSkaterNames.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < allKnownSkaterNames.length; secondIndex += 1) {
      const first = allKnownSkaterNames[firstIndex]
      const second = allKnownSkaterNames[secondIndex]
      const key = pairKey(first, second)
      const stats = pairCounts.get(key)
      pairStats.push({
        key,
        count: stats?.count ?? 0,
        label: stats ? `${stats.names[0]} + ${stats.names[1]}` : `${first} + ${second}`,
      })
    }
  }
  pairStats.sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))

  const goalieStats = new Map<string, { name: string; count: number; dates: string[] }>()
  for (const [key, name] of goalieCandidates) goalieStats.set(key, { name, count: 0, dates: [] })
  for (const scheduledGame of playedGames) {
    const goalie = (scheduledGame.playedGoalieName ?? scheduledGame.playedLineup?.goalieName)?.trim()
    if (!goalie) continue
    const key = goalie.toLowerCase()
    const stats = goalieStats.get(key) ?? { name: goalie, count: 0, dates: [] }
    stats.count += 1
    stats.dates.push(scheduledGame.date)
    goalieStats.set(key, stats)
  }
  const rotationBalance = new Map(game.players.map((player) => [
    player.id,
    { periods: 0, forwards: 0, defense: 0 },
  ]))
  for (const period of activeScheduledGame?.periodLineups ?? []) {
    for (const playerId of period.forwardPlayerIds) {
      const stats = rotationBalance.get(playerId)
      if (stats) {
        stats.periods += 1
        stats.forwards += 1
      }
    }
    for (const playerId of period.defensePlayerIds) {
      const stats = rotationBalance.get(playerId)
      if (stats) {
        stats.periods += 1
        stats.defense += 1
      }
    }
  }
  const fullIceRotationComplete = hasCompletePeriodRotation(
    activeScheduledGame?.periodLineups ?? [],
    game.players,
  )
  const fullIceShiftPositionsAvailable = hasFullIceShiftPositions(
    activeScheduledGame?.periodLineups ?? [],
  )
  const goldenBobcatStats = new Map<string, { name: string; games: { date: string; title: string }[] }>()
  for (const [key, name] of goldenBobcatCandidates) goldenBobcatStats.set(key, { name, games: [] })
  for (const scheduledGame of visibleScheduledGames) {
    const winner = scheduledGame.playedGoldenBobcatPlayerName?.trim()
    if (!winner) continue
    const key = winner.toLowerCase()
    const stats = goldenBobcatStats.get(key) ?? { name: winner, games: [] }
    stats.games.push({ date: scheduledGame.date, title: scheduledGame.title })
    goldenBobcatStats.set(key, stats)
  }
  const pairedPlayerIds = new Set(game.pairs.flatMap((pair) => [pair.playerAId, pair.playerBId]))
  const allNamesEntered = game.players.length >= PLAYERS_PER_SHIFT
    && game.players.every((player) => player.name.trim().length > 0)
    && Boolean(game.goalieName.trim())
  const enteredNames = [...game.players.map((player) => player.name), game.goalieName]
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)
  const hasDuplicateNames = new Set(enteredNames).size !== enteredNames.length
  const canShuffle = allNamesEntered && !hasDuplicateNames
  const manualPairCount = Math.floor(game.players.length / 2)
  const manualPairAssignments = new Map<number, number>()
  for (const player of game.players) {
    const pairGroup = manualPairingIds[player.id]
    if (pairGroup !== undefined) manualPairAssignments.set(pairGroup, (manualPairAssignments.get(pairGroup) ?? 0) + 1)
  }
  const manualPairingValid = game.players.length >= PLAYERS_PER_SHIFT
    && Array.from({ length: manualPairCount }, (_, index) => manualPairAssignments.get(index + 1) === 2).every(Boolean)
    && (manualPairAssignments.get(0) ?? 0) === (game.players.length % 2)
  const skaterNames = game.players.map((player) => player.name.trim().toLowerCase()).filter(Boolean)
  const hasDuplicateSkaterNames = new Set(skaterNames).size !== skaterNames.length
  const canSaveManualPairing = game.players.length >= PLAYERS_PER_SHIFT
    && game.players.every((player) => player.name.trim())
    && !hasDuplicateSkaterNames
    && manualPairingValid

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

  function storeLineup(pairs: Pair[], flexPlayerIds: number[], replaceSelected = false) {
    setManualPairingOpen(false)
    if (!activeGameId) {
      setGame((current) => ({ ...current, pairs, flexPlayerIds, shift: 1 }))
      setEditingRoster(false)
      return
    }

    const lineup: LineupOption = {
      id: createId('lineup'),
      pairs,
      flexPlayerIds,
      goalieName: game.goalieName,
      playerNames: Object.fromEntries(game.players.map((player) => [String(player.id), player.name])),
    }
    const activeGame = scheduledGames.find((scheduledGame) => scheduledGame.id === activeGameId)
    if (replaceSelected && activeGame?.selectedLineupId) {
      lineup.id = activeGame.selectedLineupId
      setScheduledGames((currentGames) => currentGames.map((scheduledGame) => {
        if (scheduledGame.id !== activeGameId) return scheduledGame
        const lineups = scheduledGame.lineups.some((option) => option.id === lineup.id)
          ? scheduledGame.lineups.map((option) => option.id === lineup.id ? lineup : option)
          : [...scheduledGame.lineups, lineup]
        return { ...scheduledGame, lineups, selectedLineupId: lineup.id }
      }))
      setGame((current) => ({ ...current, pairs, flexPlayerIds, shift: 1 }))
      setEditingRoster(false)
      return
    }

    setScheduledGames((currentGames) => currentGames.map((scheduledGame) =>
      scheduledGame.id === activeGameId
        ? {
          ...scheduledGame,
          lineups: [...scheduledGame.lineups, lineup],
          selectedLineupId: lineup.id,
        }
        : scheduledGame,
    ))
    setGame((current) => ({ ...current, pairs, flexPlayerIds, shift: 1 }))
    setEditingRoster(false)
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

    storeLineup(pairs, flexPlayerIds)
  }

  function beginManualPairing() {
    const groups: Record<number, number> = {}
    const counts = Array.from({ length: manualPairCount }, () => 0)
    const playerIds = new Set(game.players.map((player) => player.id))

    game.pairs.slice(0, manualPairCount).forEach((pair, index) => {
      for (const playerId of [pair.playerAId, pair.playerBId]) {
        if (playerIds.has(playerId) && counts[index] < 2 && groups[playerId] === undefined) {
          groups[playerId] = index + 1
          counts[index] += 1
        }
      }
    })
    for (const playerId of game.flexPlayerIds) {
      if (playerIds.has(playerId) && groups[playerId] === undefined && game.players.length % 2) {
        groups[playerId] = 0
      }
    }
    for (const player of game.players) {
      if (groups[player.id] !== undefined) continue
      const availableGroup = counts.findIndex((count) => count < 2)
      if (availableGroup >= 0) {
        groups[player.id] = availableGroup + 1
        counts[availableGroup] += 1
      } else if (game.players.length % 2) {
        groups[player.id] = 0
      }
    }

    setManualPairingIds(groups)
    setManualPairingOpen(true)
  }

  function saveManualPairing() {
    if (!canSaveManualPairing) return
    const pairs = Array.from({ length: manualPairCount }, (_, index) => {
      const playerIds = game.players
        .filter((player) => manualPairingIds[player.id] === index + 1)
        .map((player) => player.id)
      return { id: index + 1, playerAId: playerIds[0], playerBId: playerIds[1] }
    })
    const flexPlayerIds = game.players
      .filter((player) => manualPairingIds[player.id] === 0)
      .map((player) => player.id)
    storeLineup(pairs, flexPlayerIds, true)
  }

  function suggestBalancedLineup() {
    if (!canShuffle) return
    const history = new Map<string, number>()
    for (const [key, stats] of countPastPairs(scheduledGames)) history.set(key, stats.count)
    const suggestion = createBalancedPairing(game.players, history)
    storeLineup(suggestion.pairs, suggestion.flexPlayerIds)
  }

  function chooseLineup(scheduledGame: ScheduledGame, lineup: LineupOption) {
    setActiveGameId(scheduledGame.id)
    setView('bench')
    setScheduledGames((currentGames) => currentGames.map((item) =>
      item.id === scheduledGame.id ? { ...item, selectedLineupId: lineup.id } : item,
    ))
    setGame((current) => ({
      ...current,
      players: scheduledGame.players.map((player) => ({ ...player })),
      goalieName: scheduledGame.goalieName || lineup.goalieName,
      pairs: lineup.pairs.map((pair) => ({ ...pair })),
      flexPlayerIds: [...lineup.flexPlayerIds],
      shift: 1,
    }))
  }

  function removeLineupOption(scheduledGame: ScheduledGame, lineup: LineupOption) {
    if (scheduledGame.playedLineup?.id === lineup.id) return
    const remaining = scheduledGame.lineups.filter((item) => item.id !== lineup.id)
    const wasSelected = scheduledGame.selectedLineupId === lineup.id
    const nextLineup = wasSelected
      ? remaining.find((item) => item.id === scheduledGame.playedLineup?.id) ?? remaining[0] ?? null
      : remaining.find((item) => item.id === scheduledGame.selectedLineupId) ?? null

    setScheduledGames((currentGames) => currentGames.map((item) =>
      item.id === scheduledGame.id
        ? { ...item, lineups: remaining, selectedLineupId: nextLineup?.id ?? null }
        : item,
    ))

    if (wasSelected && activeGameId === scheduledGame.id) {
      setEditingRoster(false)
      setManualPairingOpen(false)
      setGame((current) => ({
        ...current,
        players: scheduledGame.players.map((player) => ({ ...player })),
        goalieName: scheduledGame.goalieName || nextLineup?.goalieName || '',
        pairs: nextLineup?.pairs.map((pair) => ({ ...pair })) ?? [],
        flexPlayerIds: nextLineup ? [...nextLineup.flexPlayerIds] : [],
        shift: 1,
      }))
    }
  }

  function openScheduledGame(scheduledGame: ScheduledGame) {
    setActiveGameId(scheduledGame.id)
    setCurrentPeriodIndex(0)
    setCurrentFullIceShiftIndex(0)
    setView('bench')
    setEditingRoster(false)
    setManualPairingOpen(false)
    const lineup = scheduledGame.lineups.find((item) => item.id === scheduledGame.selectedLineupId)
    setGame((current) => ({
      ...current,
      players: scheduledGame.players.map((player) => ({ ...player })),
      goalieName: scheduledGame.goalieName || lineup?.goalieName || '',
      pairs: lineup?.pairs.map((pair) => ({ ...pair })) ?? [],
      flexPlayerIds: lineup ? [...lineup.flexPlayerIds] : [],
      shift: 1,
    }))
  }

  function getLastGameRoster(): { players: Player[]; goalieName: string } {
    const previousGame = scheduledGames.find((item) => item.id === activeGameId && !isPracticeTitle(item.title))
      ?? visibleScheduledGames[visibleScheduledGames.length - 1]
    if (!previousGame) {
      return {
        players: game.players.map((player) => ({ ...player })),
        goalieName: game.goalieName,
      }
    }
    const selectedLineup = previousGame.lineups.find((item) => item.id === previousGame.selectedLineupId)
    return {
      players: previousGame.players.map((player) => ({ ...player })),
      goalieName: previousGame.goalieName || selectedLineup?.goalieName || previousGame.playedLineup?.goalieName || '',
    }
  }

  function addScheduledGame(date: string, title: string) {
    const roster = getLastGameRoster()
    const newGame: ScheduledGame = {
      id: createId('game'),
      date,
      title: title.trim() || 'Game',
      players: roster.players,
      goalieName: roster.goalieName,
      lineups: [],
      selectedLineupId: null,
      playedLineup: null,
      goldenBobcatPlayerName: null,
      playedGoldenBobcatPlayerName: null,
      mode: '4v4' as const,
      periodLineups: [],
      playedMode: null,
      playedPeriodLineups: null,
      playedPeriodPlayerNames: null,
      playedGoalieName: null,
    }
    setScheduledGames((currentGames) => [...currentGames, newGame].sort((a, b) => a.date.localeCompare(b.date)))
    setActiveGameId(newGame.id)
    setCurrentPeriodIndex(0)
    setCurrentFullIceShiftIndex(0)
    setGame((current) => ({
      ...current,
      players: roster.players.map((player) => ({ ...player })),
      goalieName: roster.goalieName,
      pairs: [],
      flexPlayerIds: [],
      shift: 1,
    }))
    setView('bench')
  }

  function updateActiveGameMode(mode: GameMode) {
    if (!activeGameId) return
    setCurrentPeriodIndex(0)
    setCurrentFullIceShiftIndex(0)
    setEditingRoster(false)
    setManualPairingOpen(false)
    setScheduledGames((currentGames) => currentGames.map((scheduledGame) => {
      if (scheduledGame.id !== activeGameId) return scheduledGame
      return {
        ...scheduledGame,
        mode,
        periodLineups: mode === '5v5' && !scheduledGame.periodLineups.length
          ? generateBalancedPeriodLineups(game.players)
          : scheduledGame.periodLineups,
      }
    }))
  }

  function rebalancePeriods() {
    if (!activeGameId) return
    setCurrentFullIceShiftIndex(0)
    setScheduledGames((currentGames) => currentGames.map((scheduledGame) =>
      scheduledGame.id === activeGameId
        ? { ...scheduledGame, periodLineups: generateBalancedPeriodLineups(game.players) }
        : scheduledGame,
    ))
  }

  function updatePeriodPosition(playerId: number, position: 'forward' | 'defense') {
    if (!activeGameId) return
    setCurrentFullIceShiftIndex(0)
    setScheduledGames((currentGames) => currentGames.map((scheduledGame) => {
      if (scheduledGame.id !== activeGameId) return scheduledGame
      const periods = Array.from({ length: FULL_ICE_PERIOD_COUNT }, (_, index) =>
        scheduledGame.periodLineups[index] ?? emptyPeriodLineup(),
      )
      const period = periods[currentPeriodIndex]
      const forwardPlayerIds = period.forwardPlayerIds.filter((id) => id !== playerId)
      const defensePlayerIds = period.defensePlayerIds.filter((id) => id !== playerId)
      if (position === 'forward') forwardPlayerIds.push(playerId)
      else defensePlayerIds.push(playerId)
      periods[currentPeriodIndex] = { forwardPlayerIds, defensePlayerIds }
      return { ...scheduledGame, periodLineups: periods }
    }))
  }

  function addManualGame(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!scheduleDate || !scheduleTitle.trim()) return
    if (isPracticeTitle(scheduleTitle)) {
      setScheduleMessage('Practice, skills, and pre-season ice events are filtered out. Enter a game name instead.')
      return
    }
    setScheduleMessage('')
    addScheduledGame(scheduleDate, scheduleTitle)
    setScheduleTitle('')
  }

  function addCalendarEvents(contents: string) {
    if (contents.length > 5 * 1024 * 1024) {
      setCalendarMessage('That calendar is too large to import (5 MB maximum).')
      return
    }
    const events = parseCalendarEvents(contents)
    const practiceCount = events.filter((event) => isPracticeTitle(event.title)).length
    const gameEvents = events.filter((event) => !isPracticeTitle(event.title))
    if (!gameEvents.length) {
      setCalendarMessage(practiceCount
        ? `Skipped ${practiceCount} practice event${practiceCount === 1 ? '' : 's'}; no games to import.`
        : 'No games with a start date were found in that calendar.')
      return
    }
    const roster = getLastGameRoster()
    const imported = gameEvents.map((event) => ({
      id: createId('game'),
      date: event.date,
      title: event.title,
      players: roster.players.map((player) => ({ ...player })),
      goalieName: roster.goalieName,
      lineups: [],
      selectedLineupId: null,
      playedLineup: null,
      goldenBobcatPlayerName: null,
      playedGoldenBobcatPlayerName: null,
      mode: '4v4' as const,
      periodLineups: [],
      playedMode: null,
      playedPeriodLineups: null,
      playedPeriodPlayerNames: null,
      playedGoalieName: null,
    }))
    setScheduledGames((currentGames) =>
      [...currentGames, ...imported].sort((a, b) => a.date.localeCompare(b.date)),
    )
    setCalendarMessage(
      `Imported ${imported.length} game${imported.length === 1 ? '' : 's'}.`
      + (practiceCount ? ` Skipped ${practiceCount} practice event${practiceCount === 1 ? '' : 's'}.` : ''),
    )
  }

  async function importCalendar(file: File | undefined) {
    if (!file) return
    setIsImportingCalendar(true)
    try {
      addCalendarEvents(await file.text())
    } catch {
      setCalendarMessage('Could not read that calendar file.')
    } finally {
      setIsImportingCalendar(false)
    }
  }

  async function importCalendarUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    let url: URL
    try {
      url = new URL(calendarUrl.trim())
    } catch {
      setCalendarMessage('Enter a valid calendar URL.')
      return
    }
    if (url.protocol === 'webcal:') url.protocol = 'https:'
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      setCalendarMessage('Use an HTTP(S) calendar URL without embedded credentials.')
      return
    }

    setIsImportingCalendar(true)
    setCalendarMessage('Fetching calendar…')
    try {
      const response = await fetch(url.href, { credentials: 'omit' })
      if (!response.ok) {
        setCalendarMessage(`Calendar server returned HTTP ${response.status}.`)
        return
      }
      addCalendarEvents(await response.text())
    } catch {
      setCalendarMessage('Could not fetch the calendar. Check the URL and whether its host allows browser access (CORS).')
    } finally {
      setIsImportingCalendar(false)
    }
  }

  function recordActiveGame() {
    if (!activeGameId) return
    const activeGame = scheduledGames.find((item) => item.id === activeGameId)
    if (!activeGame) return
    if (activeGame.mode === '5v5' && !hasCompletePeriodRotation(activeGame.periodLineups, game.players)) return
    if (activeGame.mode === '4v4' && !game.pairs.length) return
    const lineup = activeGame.mode === '4v4' ? {
      id: activeGame.selectedLineupId ?? createId('lineup'),
      pairs: game.pairs.map((pair) => ({ ...pair })),
      flexPlayerIds: [...game.flexPlayerIds],
      goalieName: game.goalieName,
      playerNames: playerNameSnapshot(game.players),
    } : null
    setScheduledGames((currentGames) => currentGames.map((item) => {
      if (item.id !== activeGameId) return item
      const lineups = lineup
        ? item.lineups.some((option) => option.id === lineup.id)
          ? item.lineups.map((option) => option.id === lineup.id ? lineup : option)
          : [...item.lineups, lineup]
        : item.lineups
      return {
        ...item,
        lineups,
        selectedLineupId: lineup?.id ?? item.selectedLineupId,
        playedLineup: lineup,
        playedMode: item.mode,
        playedPeriodLineups: item.mode === '5v5'
          ? clonePeriodLineups(item.periodLineups)
          : null,
        playedPeriodPlayerNames: item.mode === '5v5'
          ? playerNameSnapshot(game.players)
          : null,
        playedGoalieName: game.goalieName,
        playedGoldenBobcatPlayerName: item.goldenBobcatPlayerName,
      }
    }))
    setEditingRoster(false)
    setManualPairingOpen(false)
  }

  function updateGoldenBobcatSelection(playerName: string) {
    if (!activeGameId) return
    setScheduledGames((currentGames) => currentGames.map((scheduledGame) =>
      scheduledGame.id === activeGameId
        ? { ...scheduledGame, goldenBobcatPlayerName: playerName || null }
        : scheduledGame,
    ))
  }

  function resetGame() {
    if (window.confirm('Reset the game to shift 1? Your roster and pairs will stay saved.')) {
      setGame((current) => ({ ...current, shift: 1 }))
    }
  }

  async function copyLineup() {
    const playerName = (playerId: number) => {
      const player = game.players.find((item) => item.id === playerId)
      return player?.name.trim() || `Player ${playerId}`
    }
    const lines = [
      `G: ${game.goalieName.trim() || 'Goalie not set'}`,
      ...game.pairs.map((pair) =>
        `${playerName(pair.playerAId)}/${playerName(pair.playerBId)}`,
      ),
      ...game.players
        .filter((player) => !pairedPlayerIds.has(player.id))
        .map((player) => playerName(player.id)),
    ]
    const text = lines.join('\n')

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.setAttribute('readonly', '')
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        const copied = document.execCommand('copy')
        document.body.removeChild(textarea)
        if (!copied) throw new Error('Copy command failed')
      }
      setCopyStatus('copied')
    } catch {
      setCopyStatus('error')
    }

    window.setTimeout(() => setCopyStatus('idle'), 1800)
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
        <div className="game-tag">
          <span className="live-dot" /> {isFullIce ? 'FULL ICE' : 'HALF ICE'} <b>{activeGameMode}</b>
        </div>
      </header>

      <nav className="view-tabs" aria-label="Main navigation">
        {(['bench', 'schedule', 'analytics'] as const).map((tab) => (
          <button
            className={view === tab ? 'view-tab is-active' : 'view-tab'}
            type="button"
            key={tab}
            onClick={() => setView(tab)}
            aria-current={view === tab ? 'page' : undefined}
          >
            {tab === 'bench' ? 'Bench' : tab === 'schedule' ? 'Schedule' : 'Analytics'}
          </button>
        ))}
      </nav>

      {view === 'bench' ? <div className="page-grid">
        <section className="bench-panel" aria-labelledby="bench-title">
          <div className="section-kicker">
            <span>{activeScheduledGame?.title || 'BENCH BOARD'}</span>
            <span className="shift-number">
            {isFullIce
              ? `PERIOD ${currentPeriodIndex + 1} · SHIFT ${String(currentFullIceShiftIndex + 1).padStart(2, '0')}`
              : `SHIFT ${String(game.shift).padStart(2, '0')}`}
            </span>
          </div>
          <div className="bench-heading">
            <div>
              <p className="eyebrow">{isFullIce ? 'ON ICE THIS SHIFT' : 'CALL THESE LINES'}</p>
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

          {isFullIce && activeScheduledGame ? (
            <>
              <div className="full-ice-assignments" aria-live="polite">
                <article className="assignment defense-assignment">
                  <div className="assignment-topline">
                    <span className="role-marker">D</span>
                    <span className="role-label">DEFENSE</span>
                    <span className="role-side">{currentFullIceShiftLineup.defensePlayerIds.length}/{DEFENSE_PAIR_SIZE} on</span>
                  </div>
                  <div className="full-ice-on-ice-list">
                    {currentFullIceShiftLineup.defensePlayerIds.map((playerId) => (
                      <div className="full-ice-on-ice-player" key={playerId}>
                        <strong>{periodPlayerNames([playerId], game.players)}</strong>
                        {doubleShiftPlayerIds.has(playerId) && (
                          <span className="double-shift-badge">Double shift · stay out next</span>
                        )}
                      </div>
                    ))}
                    {!currentFullIceShiftLineup.defensePlayerIds.length && <span>No players assigned</span>}
                  </div>
                  <p className="pair-caption">On-ice defense pair</p>
                </article>
                <article className="assignment offense-assignment">
                  <div className="assignment-topline">
                    <span className="role-marker">F</span>
                    <span className="role-label">FORWARDS</span>
                    <span className="role-side">{currentFullIceShiftLineup.forwardPlayerIds.length}/{FORWARD_LINE_SIZE} on</span>
                  </div>
                  <div className="full-ice-on-ice-list">
                    {currentFullIceShiftLineup.forwardPlayerIds.map((playerId) => (
                      <div className="full-ice-on-ice-player" key={playerId}>
                        <strong>{periodPlayerNames([playerId], game.players)}</strong>
                        {doubleShiftPlayerIds.has(playerId) && (
                          <span className="double-shift-badge">Double shift · stay out next</span>
                        )}
                      </div>
                    ))}
                    {!currentFullIceShiftLineup.forwardPlayerIds.length && <span>No players assigned</span>}
                  </div>
                  <p className="pair-caption">On-ice forward line</p>
                </article>
              </div>
              <div className="shift-navigation">
                <button
                  className="previous-button"
                  type="button"
                  onClick={() => setCurrentFullIceShiftIndex((shift) => Math.max(0, shift - 1))}
                  disabled={currentFullIceShiftIndex === 0 || !fullIceRotationComplete}
                >← Previous shift</button>
                <button
                  className="next-button"
                  type="button"
                  onClick={() => setCurrentFullIceShiftIndex((shift) => shift + 1)}
                  disabled={!fullIceRotationComplete}
                >Next shift <span className="button-arrow" aria-hidden="true">→</span></button>
              </div>
              <div className="period-navigation">
                <button
                  className="previous-button"
                  type="button"
                  onClick={() => {
                    setCurrentPeriodIndex((period) => Math.max(0, period - 1))
                    setCurrentFullIceShiftIndex(0)
                  }}
                  disabled={currentPeriodIndex === 0}
                >← Previous period</button>
                <button
                  className="next-button"
                  type="button"
                  onClick={() => {
                    setCurrentPeriodIndex((period) => Math.min(FULL_ICE_PERIOD_COUNT - 1, period + 1))
                    setCurrentFullIceShiftIndex(0)
                  }}
                  disabled={currentPeriodIndex === FULL_ICE_PERIOD_COUNT - 1}
                >Next period <span className="button-arrow" aria-hidden="true">→</span></button>
              </div>
              <p className="rotation-note">Next shift rotates the on-ice lines and shares any double shifts evenly. Next period resets the shift rotation.</p>
            </>
          ) : (
            <>
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
            </>
          )}
          {activeScheduledGame && (
            <div className="game-lineup-controls">
              <p className="eyebrow">{formatGameDate(activeScheduledGame.date)} · {isFullIce ? 'FULL ICE ROTATION' : "THIS GAME'S LINEUPS"}</p>
              <label className="game-mode-select" htmlFor="active-game-mode">
                <span>Game format</span>
                <select
                  id="active-game-mode"
                  value={activeScheduledGame.mode}
                  onChange={(event) => updateActiveGameMode(event.target.value === '5v5' ? '5v5' : '4v4')}
                >
                  <option value="4v4">Half ice · 4v4</option>
                  <option value="5v5">Full ice · 5v5</option>
                </select>
              </label>

              {isFullIce ? (
                <>
                  <div className="period-tabs" aria-label="Choose period">
                    {Array.from({ length: FULL_ICE_PERIOD_COUNT }, (_, index) => (
                      <button
                        className={index === currentPeriodIndex ? 'period-tab is-active' : 'period-tab'}
                        type="button"
                        key={index}
                        onClick={() => {
                          setCurrentPeriodIndex(index)
                          setCurrentFullIceShiftIndex(0)
                        }}
                        aria-pressed={index === currentPeriodIndex}
                      >Period {index + 1}</button>
                    ))}
                  </div>
                  <p className="roster-helper">Every named skater is assigned a position in every period. Auto-balance shares defense duty, favors three defense when it avoids an odd forward count, and rotates line groups.</p>
                  <div className="period-slot-editor">
                    <section className="period-position-group">
                      <h3>Defense · {currentPeriodLineup.defensePlayerIds.length} players</h3>
                      {currentDefenseGroups.map((group, groupIndex) => (
                        <div className="period-line-group" key={`defense-group-${groupIndex}`}>
                          <h4>{group.length === DEFENSE_PAIR_SIZE ? `Pair ${groupIndex + 1}` : `Group ${groupIndex + 1}`}</h4>
                          {group.map((playerId) => {
                            const player = namedSkaters.find((skater) => skater.id === playerId)
                            if (!player) return null
                            return (
                              <label className="period-player-assignment" key={player.id}>
                                <span>{player.name}</span>
                                <select
                                  value="defense"
                                  onChange={(event) => updatePeriodPosition(
                                    player.id,
                                    event.target.value === 'defense' ? 'defense' : 'forward',
                                  )}
                                  aria-label={`Position for ${player.name}, period ${currentPeriodIndex + 1}`}
                                >
                                  <option value="forward">Forward</option>
                                  <option value="defense">Defense</option>
                                </select>
                              </label>
                            )
                          })}
                        </div>
                      ))}
                    </section>
                    <section className="period-position-group">
                      <h3>Forwards · {currentPeriodLineup.forwardPlayerIds.length} players</h3>
                      {currentForwardGroups.map((group, groupIndex) => (
                        <div className="period-line-group" key={`forward-group-${groupIndex}`}>
                          <h4>Line {groupIndex + 1}</h4>
                          {group.map((playerId) => {
                            const player = namedSkaters.find((skater) => skater.id === playerId)
                            if (!player) return null
                            return (
                              <label className="period-player-assignment" key={player.id}>
                                <span>{player.name}</span>
                                <select
                                  value="forward"
                                  onChange={(event) => updatePeriodPosition(
                                    player.id,
                                    event.target.value === 'defense' ? 'defense' : 'forward',
                                  )}
                                  aria-label={`Position for ${player.name}, period ${currentPeriodIndex + 1}`}
                                >
                                  <option value="forward">Forward</option>
                                  <option value="defense">Defense</option>
                                </select>
                              </label>
                            )
                          })}
                        </div>
                      ))}
                    </section>
                  </div>
                  {namedSkaters.length < 5 && (
                    <p className="roster-helper">At least five named skaters are needed to record a 5v5 game.</p>
                  )}
                  {namedSkaters.length >= 5 && !fullIceShiftPositionsAvailable && (
                    <p className="roster-helper">Each period needs at least three forwards and two defensemen to fill a 5v5 shift.</p>
                  )}
                  <div className="game-lineup-actions">
                    <button className="secondary-button" type="button" onClick={rebalancePeriods} disabled={!namedSkaters.length}>
                      Auto-balance rotation
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={recordActiveGame}
                      disabled={!fullIceRotationComplete || (hasRecordedGame && !activeNeedsRerecord)}
                    >
                      {hasRecordedGame
                        ? activeNeedsRerecord ? 'Re-record game' : 'Game recorded'
                        : fullIceRotationComplete ? 'Record game' : fullIceShiftPositionsAvailable ? 'Complete all periods' : 'Need 3 F / 2 D'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="lineup-option-list">
                    {activeScheduledGame.lineups.map((lineup, index) => {
                      const isRecorded = activeScheduledGame.playedMode !== '5v5'
                        && activeScheduledGame.playedLineup?.id === lineup.id
                      return (
                        <div className="lineup-option-row" key={lineup.id}>
                          <button
                            className={activeScheduledGame.selectedLineupId === lineup.id ? 'lineup-option is-selected' : 'lineup-option'}
                            type="button"
                            onClick={() => chooseLineup(activeScheduledGame, lineup)}
                          >
                            <strong>
                              Lineup {index + 1}
                              {isRecorded && <span className="recorded-badge">RECORDED</span>}
                            </strong>
                            <span>{lineupPairSummary(lineup, game.players) || 'No pairs yet'}</span>
                          </button>
                          <button
                            className="remove-lineup-button"
                            type="button"
                            onClick={() => removeLineupOption(activeScheduledGame, lineup)}
                            disabled={isRecorded}
                            aria-label={`Remove lineup ${index + 1}${isRecorded ? ' (recorded)' : ''}`}
                            title={isRecorded ? 'The recorded lineup is kept for analytics' : `Remove lineup ${index + 1}`}
                          >×</button>
                        </div>
                      )
                    })}
                  </div>
                  <div className="game-lineup-actions">
                    <button className="secondary-button" type="button" onClick={shufflePairs} disabled={!canShuffle}>Shuffle another</button>
                    <button className="secondary-button" type="button" onClick={suggestBalancedLineup} disabled={!canShuffle}>Suggest balanced</button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={recordActiveGame}
                      disabled={!game.pairs.length || (hasRecordedGame && !activeNeedsRerecord)}
                    >
                      {hasRecordedGame
                        ? activeNeedsRerecord ? 'Re-record game' : 'Game recorded'
                        : game.pairs.length ? 'Record game' : 'Create a lineup first'}
                    </button>
                  </div>
                </>
              )}

              {hasRecordedGame && (
                <div className="recorded-lineup-summary" aria-label="Recorded game">
                  <strong>{activeNeedsRerecord ? 'RECORDED VERSION · CHANGES PENDING' : 'RECORDED FOR THIS GAME'}</strong>
                  {activeScheduledGame.playedMode === '5v5' && activeScheduledGame.playedPeriodLineups && (
                    <>
                      {activeScheduledGame.playedPeriodLineups.map((period, index) => (
                        <span key={index}>
                          Period {index + 1}: {periodLineupSummary(period, game.players, activeScheduledGame.playedPeriodPlayerNames)}
                        </span>
                      ))}
                      <span>Goalie: {activeScheduledGame.playedGoalieName || 'Not set'}</span>
                    </>
                  )}
                  {activeScheduledGame.playedMode !== '5v5' && activeScheduledGame.playedLineup && (
                    <>
                      <span>{lineupPairSummary(activeScheduledGame.playedLineup, game.players) || 'No pairs recorded'}</span>
                      <span>Goalie: {activeScheduledGame.playedGoalieName || activeScheduledGame.playedLineup.goalieName || 'Not set'}</span>
                    </>
                  )}
                  <span>Golden Bobcat: {activeScheduledGame.playedGoldenBobcatPlayerName || 'No recipient recorded'}</span>
                </div>
              )}
              <div className="golden-bobcat-control">
                <label htmlFor="golden-bobcat-recipient">Golden Bobcat recipient</label>
                <div>
                  <select
                    id="golden-bobcat-recipient"
                    value={activeScheduledGame.goldenBobcatPlayerName ?? ''}
                    onChange={(event) => updateGoldenBobcatSelection(event.target.value)}
                  >
                    <option value="">No recipient selected</option>
                    {activeScheduledGame.goalieName.trim() && (
                      <option value={activeScheduledGame.goalieName.trim()}>
                        {activeScheduledGame.goalieName.trim()} (goalie)
                      </option>
                    )}
                    {activeScheduledGame.goldenBobcatPlayerName
                      && activeScheduledGame.goldenBobcatPlayerName !== activeScheduledGame.goalieName.trim()
                      && !game.players.some((player) => player.name.trim() === activeScheduledGame.goldenBobcatPlayerName)
                      && <option value={activeScheduledGame.goldenBobcatPlayerName}>
                        Current: {activeScheduledGame.goldenBobcatPlayerName}
                      </option>}
                    {game.players.filter((player) => player.name.trim()).map((player) => (
                      <option key={player.id} value={player.name.trim()}>{player.name.trim()}</option>
                    ))}
                  </select>
                </div>
                <p className="roster-helper">
                  {activeScheduledGame.goldenBobcatPlayerName
                    ? `Selected: ${activeScheduledGame.goldenBobcatPlayerName}. Record or re-record the game to update analytics.`
                    : 'Select a skater or goalie before recording the game.'}
                </p>
              </div>
              {hasRecordedGame && (
                <p className="roster-helper">
                  {activeNeedsRerecord
                    ? 'Changes are pending; re-record this game to update analytics.'
                    : 'This game is recorded in analytics.'}
                </p>
              )}
            </div>
          )}
        </section>

        <aside className="roster-panel" aria-labelledby="roster-title">
          <div className="roster-heading">
            <div>
              <p className="eyebrow">{isFullIce ? namedSkaters.length : game.players.length} SKATERS / 1 GOALIE</p>
              <h2 id="roster-title">{isFullIce ? 'Rotation balance' : 'Lineup'}</h2>
            </div>
            <div className="roster-heading-actions">
              {!isFullIce && (
                <button
                  className="copy-button"
                  type="button"
                  onClick={copyLineup}
                  disabled={game.players.length === 0}
                >
                  {copyStatus === 'copied' ? 'Copied' : copyStatus === 'error' ? 'Copy failed' : 'Copy lineup'}
                </button>
              )}
              <button
                className="edit-button"
                type="button"
                onClick={() => {
                  setEditingRoster((editing) => !editing)
                  setManualPairingOpen(false)
                  setCurrentFullIceShiftIndex(0)
                }}
                aria-expanded={editingRoster}
              >
                {editingRoster ? 'Done' : game.goalieName.trim() ? 'Edit roster' : 'Set roster'}
              </button>
            </div>
          </div>

          {editingRoster ? (
            <div className="roster-editor">
              {manualPairingOpen ? (
                <section className="manual-pair-editor" aria-labelledby="manual-pair-title">
                  <div className="manual-pair-heading">
                    <h3 id="manual-pair-title">Set pairs manually</h3>
                    <button className="edit-button" type="button" onClick={() => setManualPairingOpen(false)}>Back to roster</button>
                  </div>
                  <p className="roster-helper">Choose a pair number for each skater. Each pair needs two skaters.</p>
                  <ol className="manual-pair-list">
                    {game.players.map((player) => (
                      <li className="manual-pair-row" key={player.id}>
                        <span>{player.name || `Player ${player.id}`}</span>
                        <label>
                          <span className="sr-only">Pair for {player.name || `player ${player.id}`}</span>
                          <select
                            value={manualPairingIds[player.id] ?? ''}
                            onChange={(event) => {
                              const value = event.target.value
                              setManualPairingIds((current) => {
                                const next = { ...current }
                                if (value) next[player.id] = Number(value)
                                else delete next[player.id]
                                return next
                              })
                            }}
                          >
                            <option value="">Select pair</option>
                            {Array.from({ length: manualPairCount }, (_, index) => (
                              <option value={index + 1} key={index + 1}>Pair {index + 1}</option>
                            ))}
                            {game.players.length % 2 === 1 && <option value={0}>Rotating skater</option>}
                          </select>
                        </label>
                      </li>
                    ))}
                  </ol>
                  <p className="roster-helper" aria-live="polite">
                    {game.players.length < PLAYERS_PER_SHIFT
                      ? `At least ${PLAYERS_PER_SHIFT} skaters are needed.`
                      : !game.players.every((player) => player.name.trim())
                        ? 'Enter every skater name before saving.'
                        : hasDuplicateSkaterNames
                          ? 'Each skater needs a unique name.'
                          : !manualPairingValid
                            ? 'Assign exactly two skaters to each pair.'
                            : `${manualPairCount} pairs ready${game.players.length % 2 ? '; one skater rotates.' : '.'}`}
                  </p>
                  <button className="shuffle-button" type="button" onClick={saveManualPairing} disabled={!canSaveManualPairing}>
                    Save manual pairs
                  </button>
                </section>
              ) : (
                <>
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
                {isFullIce ? (
                  <p className="roster-helper" aria-live="polite">
                    Full-ice rotations are regenerated from this roster. Set at least five skater names, then auto-balance or edit each period.
                  </p>
                ) : (
                  <>
                    <button className="shuffle-button" type="button" onClick={shufflePairs} disabled={!canShuffle}>
                      Shuffle pairs
                    </button>
                    <button className="edit-button manual-pair-toggle" type="button" onClick={beginManualPairing}>
                      Set pairs manually
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
                  </>
                )}
              </div>
                </>
              )}
            </div>
          ) : isFullIce ? (
            <>
              <div className="goalie-banner">
                <span className="goalie-badge">G</span>
                <span className="goalie-name">
                  <strong>{game.goalieName || 'Goalie not set'}</strong>
                  <small>GOALIE · FULL GAME</small>
                </span>
              </div>
              <ol className="roster-list">
                {namedSkaters.map((player) => {
                  const role = currentPeriodLineup.defensePlayerIds.includes(player.id)
                    ? 'DEFENSE'
                    : currentPeriodLineup.forwardPlayerIds.includes(player.id) ? 'FORWARD' : 'REST'
                  const roleClass = role === 'FORWARD' ? 'offense' : role.toLowerCase()
                  const balance = rotationBalance.get(player.id) ?? { periods: 0, forwards: 0, defense: 0 }
                  return (
                    <li className="roster-row" key={player.id}>
                      <span className="roster-index">{String(player.id).padStart(2, '0')}</span>
                      <span className="roster-name">
                        <strong>{player.name || `Player ${player.id}`}</strong>
                        <small>{balance.periods} periods · {balance.forwards} F / {balance.defense} D</small>
                      </span>
                      <span className={`roster-status ${roleClass}`}>{role}</span>
                    </li>
                  )
                })}
              </ol>
              <p className="roster-helper">This period’s position is shown at right. Total periods and F/D assignments show balance across all three periods.</p>
            </>
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
            <span className="ice-key"><i className="key-offense" /> {isFullIce ? 'Forward' : 'Offense'}</span>
            <span className="ice-key"><i className="key-defense" /> Defense</span>
            <span className="ice-key"><i className="key-rest" /> Rest</span>
          </div>
        </aside>
      </div> : view === 'schedule' ? (
        <main className="content-panel">
          <div className="content-heading">
            <div><p className="eyebrow">YOUR SEASON</p><h1>Schedule<span>.</span></h1></div>
          </div>
          <div className="schedule-tools">
            <form className="manual-game-form" onSubmit={addManualGame}>
              <h2>Add a game</h2>
              <label>Opponent or game name
                <input value={scheduleTitle} onChange={(event) => { setScheduleTitle(event.target.value); setScheduleMessage('') }} placeholder="e.g. Bobcats vs Wolves" required />
              </label>
              <label>Date and time
                <input type="datetime-local" value={scheduleDate} onChange={(event) => setScheduleDate(event.target.value)} required />
              </label>
              <button className="primary-button" type="submit">Add game</button>
              <p className="roster-helper" aria-live="polite">{scheduleMessage}</p>
            </form>
            <div className="calendar-import">
              <h2>Import calendar</h2>
              <p>Import games from an .ics file or calendar URL. Practices, skills, and pre-season ice are skipped; existing games are kept.</p>
              <form className="calendar-url-form" onSubmit={(event) => void importCalendarUrl(event)}>
                <label htmlFor="calendar-url">ICS calendar URL</label>
                <input
                  id="calendar-url"
                  type="text"
                  inputMode="url"
                  value={calendarUrl}
                  onChange={(event) => setCalendarUrl(event.target.value)}
                  placeholder="https://… or webcal://…"
                  maxLength={2048}
                  required
                />
                <button className="primary-button" type="submit" disabled={isImportingCalendar}>
                  {isImportingCalendar ? 'Fetching…' : 'Fetch calendar'}
                </button>
              </form>
              <p className="calendar-hint">The calendar host must allow browser access (CORS). webcal URLs use HTTPS.</p>
              <label className="file-button">Choose .ics file
                <input
                  type="file"
                  accept=".ics,.ical,text/calendar"
                  disabled={isImportingCalendar}
                  onChange={(event) => void importCalendar(event.target.files?.[0])}
                />
              </label>
              <p className="roster-helper" aria-live="polite">{calendarMessage}</p>
            </div>
          </div>
          <div className="schedule-list-section">
            <h2>Games <span>{visibleScheduledGames.length}</span></h2>
            {visibleScheduledGames.length ? (
              <ul className="schedule-list">
                {visibleScheduledGames.map((scheduledGame) => (
                  <li className="schedule-row" key={scheduledGame.id}>
                    <div className="schedule-date">{formatGameDate(scheduledGame.date)}</div>
                    <div className="schedule-description">
                      <strong>{scheduledGame.title}</strong>
                      <span>
                        {scheduledGame.playedMode === '5v5'
                          ? `Played · 5v5 rotation recorded${needsGameRerecord(scheduledGame) ? ' · update needed' : ''}`
                          : scheduledGame.playedLineup
                            ? `Played · Lineup ${Math.max(1, scheduledGame.lineups.findIndex((lineup) => lineup.id === scheduledGame.playedLineup?.id) + 1)} recorded${needsGameRerecord(scheduledGame) ? ' · update needed' : ''}`
                            : `${scheduledGame.mode} · ${scheduledGame.lineups.length} saved lineup${scheduledGame.lineups.length === 1 ? '' : 's'}`}
                      </span>
                    </div>
                    <button className="edit-button" type="button" onClick={() => openScheduledGame(scheduledGame)}>Open lineup</button>
                  </li>
                ))}
              </ul>
            ) : <p className="empty-message">
              {scheduledGames.length
                ? 'No games to show. Practice, skills, and pre-season ice events are filtered out.'
                : 'No games yet. Add one or import your calendar.'}
            </p>}
          </div>
        </main>
      ) : (
        <main className="content-panel">
          <div className="content-heading">
            <div><p className="eyebrow">FAIR PLAY OVER TIME</p><h1>Analytics<span>.</span></h1></div>
          </div>
          <p className="analytics-note">Statistics use each game's recorded snapshot. Zero-count pairings, goalie appearances, and Golden Bobcat awards are included for players known from saved rosters. Re-record a game to apply lineup or award changes; pair counts are game-level, not shift-level.</p>
          <section className="analytics-section">
            <div className="analytics-section-heading"><h2>Skater pairs</h2><span>{playedGames.length} recorded games</span></div>
            {pairStats.length ? (
              <ul className="analytics-list">
                {pairStats.map((pair) => (
                  <li key={pair.key}>
                    <strong>{pair.label}</strong>
                    <span>
                      {pair.count} {pair.count === 1 ? 'game' : 'games'}
                      {pair.count ? '' : ' · Not yet'}
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="empty-message">Record played games to see which skaters have paired up.</p>}
          </section>
          <section className="analytics-section">
            <div className="analytics-section-heading"><h2>Goalie appearances</h2><span>All known players · games and dates</span></div>
            {goalieStats.size ? (
              <ul className="analytics-list goalie-analytics">
                {[...goalieStats].sort((a, b) => b[1].count - a[1].count || a[1].name.localeCompare(b[1].name)).map(([key, stats]) => (
                  <li key={key}>
                    <strong>{stats.name}</strong>
                    <span>
                      {stats.count} {stats.count === 1 ? 'game' : 'games'}
                      {stats.dates.length ? ` · ${stats.dates.map(formatGameDate).join(', ')}` : ' · Not yet'}
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="empty-message">Add players to a roster to see goalie appearances.</p>}
          </section>
          <section className="analytics-section">
            <div className="analytics-section-heading"><h2>Golden Bobcat winners</h2><span>All known players · awards and dates</span></div>
            {goldenBobcatStats.size ? (
              <ul className="analytics-list goalie-analytics">
                {[...goldenBobcatStats].sort((a, b) =>
                  b[1].games.length - a[1].games.length || a[1].name.localeCompare(b[1].name),
                ).map(([key, stats]) => (
                  <li key={key}>
                    <strong>{stats.name}</strong>
                    <span>
                      {stats.games.length} {stats.games.length === 1 ? 'award' : 'awards'}
                      {stats.games.length
                        ? ` · ${stats.games.map((gameEntry) => `${formatGameDate(gameEntry.date)} — ${gameEntry.title}`).join(', ')}`
                        : ' · Not yet'}
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="empty-message">Add players to a roster to see Golden Bobcat history.</p>}
          </section>
        </main>
      )}
      <footer className="app-footer">
        <span>ORYA BOBCATS</span>
        <span>BUILT FOR THE BENCH <i>✳</i></span>
      </footer>
    </main>
  )
}

export default App
