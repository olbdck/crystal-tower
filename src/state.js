// Shared runtime state of this browser tab. Modules read and write these fields directly;
// keep it flat, and put anything that only one module needs inside that module instead.
export const S = {
  // connection to the table
  room: null, // current table room (transport API) or the solo stand-in
  lobby: null, // transport entry point used to join tables
  soloMode: false, // no network: the tab plays alone
  roomReady: false, // joined a table's channel and can sit down
  connected: true, // broker connection is up
  connectedSince: 0,
  disconnectedSince: 0,
  tableName: null, // e.g. "stil-ek3m9q"
  switching: false, // moving between tables
  invitedByHash: false, // opened from an invite link or a code
  netFailed: null, // table name we could not reach
  versionBlock: null, // { newer, name }: this table runs another build, we cannot sit down

  // who we are
  myPeer: null, // transport label of this tab
  myName: "",
  joined: false, // sat down at the table (otherwise just looking)
  myPres: {}, // our presence object as last sent
  peerList: [], // everyone at the table, from the transport

  // game state
  isHost: false, // this tab runs the simulation
  sim: null, // our copy of the game: the authoritative one while hosting, else replayed from the host's stream
  cur: null, // { peer, e }: who hosts the game we follow, and its epoch
  lastStateAt: 0, // when the host's stream last arrived
  rttMs: null, // round trip of our own actions
  queue: [], // our actions not yet confirmed by the host

  // input
  hoverCell: -1,
  armedCell: -1, // touch: first tap arms a cell, second tap builds
  buildType: -1, // selected tower card
  castSlot: -1, // spell in hand waiting for a target on the board
  selCell: -1, // selected tower on the board
  upgradePreview: false, // pointer is on "Upgrade": show the next level's range

  mySeat: -1, // our seat in the current view, for effects
  uiDirty: true, // HUD needs a refresh
};
