// Shared action handlers for the in-game screen.
//
// Components call these instead of emitting directly so we have one place to
// (a) maintain the typed-payload contract with the server and (b) co-locate
// the local store updates that should fire optimistically alongside an emit
// (clearing a prompt, marking UNO-emitted, etc.). The server is still
// authoritative — these handlers never mutate game state, only ephemeral UI.

import { ClientEvents, type PlayableColor } from '@uno/shared';

import { emit } from './socket.js';
import { navigate } from './router.js';
import {
  awaitingStartingColor,
  playableDrawn,
  roomState,
  roundEndState,
  matchEndState,
  screen,
  unoCallEmitted,
  w4ChallengePrompt,
} from './store.js';

export interface GameActions {
  playCard(cardId: string, chosenColor?: PlayableColor): void;
  drawCard(): void;
  passTurn(): void;
  callUno(): void;
  catchUno(targetId: string): void;
  respondW4(challenge: boolean): void;
  setStartingColor(color: PlayableColor): void;
  nextRound(): void;
  playAgain(): void;
  leaveRoom(): void;
}

/**
 * Hook returning the bound game actions. Stateless — fine to call per render.
 */
export function useGameActions(): GameActions {
  return {
    playCard(cardId, chosenColor) {
      emit(ClientEvents.PLAY_CARD, { cardId, chosenColor });
      // The drew-and-can-play modal (if any) is consumed by this action.
      playableDrawn.value = null;
    },
    drawCard() {
      emit(ClientEvents.DRAW_CARD, {});
    },
    passTurn() {
      emit(ClientEvents.PASS_TURN, {});
      playableDrawn.value = null;
    },
    callUno() {
      emit(ClientEvents.CALL_UNO, {});
      unoCallEmitted.value = true;
    },
    catchUno(targetId) {
      emit(ClientEvents.CATCH_UNO, { targetId });
    },
    respondW4(challenge) {
      emit(ClientEvents.CHALLENGE_W4, { challenge });
      w4ChallengePrompt.value = null;
    },
    setStartingColor(color) {
      emit(ClientEvents.SET_STARTING_COLOR, { color });
      awaitingStartingColor.value = false;
    },
    nextRound() {
      emit(ClientEvents.NEXT_ROUND, {});
    },
    playAgain() {
      emit(ClientEvents.PLAY_AGAIN, {});
    },
    leaveRoom() {
      emit(ClientEvents.LEAVE_ROOM, {});
      // Reset local state so re-entering /home is clean. The server will also
      // send room_updated to others; for the leaver we just navigate home.
      roomState.value = null;
      roundEndState.value = null;
      matchEndState.value = null;
      screen.value = 'home';
      navigate('/', { replace: true });
    },
  };
}
