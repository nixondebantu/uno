// Home screen — name + avatar picker, Create/Join CTAs.
// Per PRD §10.1.

import type { JSX } from 'preact';
import { signal, computed } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import {
  ClientEvents,
  NAME_MIN,
  NAME_MAX,
  ROOM_CODE_LEN,
  type CreateRoomPayload,
  type JoinRoomPayload,
} from '@uno/shared';

import styles from './Home.module.css';
import { AVATARS, AVATAR_ICONS, isAvatarName } from '../avatars.js';
import { emit } from '../socket.js';
import { routeRoomCode } from '../router.js';
import { pendingError } from '../store.js';

const LAST_NAME_STORAGE_KEY = 'uno_last_name';
const LAST_AVATAR_STORAGE_KEY = 'uno_last_avatar';

// ---------- Module-scoped form signals ----------
// Module-scoped (not useState) so they survive component remounts when the
// screen toggles between home/lobby — keeps the last name typed.

const initialName = readStored(LAST_NAME_STORAGE_KEY) ?? '';
const initialAvatarRaw = readStored(LAST_AVATAR_STORAGE_KEY);
const initialAvatar: string =
  initialAvatarRaw && isAvatarName(initialAvatarRaw)
    ? initialAvatarRaw
    : AVATARS[0];

const nameSig = signal<string>(initialName);
const avatarSig = signal<string>(initialAvatar);
const joinModeSig = signal<boolean>(false);
const roomCodeSig = signal<string>('');

const nameValidation = computed(() => validateName(nameSig.value));
const codeValidation = computed(() => validateRoomCode(roomCodeSig.value));

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable — caller proceeds with in-memory state.
  }
}

const NAME_RE = /^[A-Za-z0-9 ]+$/;

function validateName(raw: string): { ok: boolean; error: string | null } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: null }; // empty = no error shown yet
  }
  if (trimmed.length < NAME_MIN) {
    return { ok: false, error: `Need at least ${NAME_MIN} characters.` };
  }
  if (trimmed.length > NAME_MAX) {
    return { ok: false, error: `Max ${NAME_MAX} characters.` };
  }
  if (!NAME_RE.test(trimmed)) {
    return { ok: false, error: 'Letters, numbers and spaces only.' };
  }
  return { ok: true, error: null };
}

function validateRoomCode(raw: string): { ok: boolean; error: string | null } {
  if (raw.length === 0) return { ok: false, error: null };
  if (raw.length !== ROOM_CODE_LEN) {
    return { ok: false, error: `Code must be ${ROOM_CODE_LEN} characters.` };
  }
  if (!/^[A-Z0-9]+$/.test(raw)) {
    return { ok: false, error: 'Letters and numbers only.' };
  }
  return { ok: true, error: null };
}

// ---------- Component ----------

export function Home(): JSX.Element {
  // If the URL points at /room/:CODE on first render, prefill code + join mode.
  useEffect(() => {
    const urlCode = routeRoomCode();
    if (urlCode) {
      roomCodeSig.value = urlCode;
      joinModeSig.value = true;
    }
  }, []);

  const onNameInput = (e: JSX.TargetedEvent<HTMLInputElement>): void => {
    const raw = e.currentTarget.value;
    // Strip illegal chars eagerly so the user can't get stuck on a bad value.
    const cleaned = raw.replace(/[^A-Za-z0-9 ]/g, '').slice(0, NAME_MAX);
    nameSig.value = cleaned;
  };

  const onCodeInput = (e: JSX.TargetedEvent<HTMLInputElement>): void => {
    const raw = e.currentTarget.value;
    const cleaned = raw
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, ROOM_CODE_LEN);
    roomCodeSig.value = cleaned;
  };

  const canCreate = nameValidation.value.ok;
  const canJoin = canCreate && codeValidation.value.ok;

  const onCreate = (): void => {
    if (!canCreate) return;
    const name = nameSig.value.trim();
    writeStored(LAST_NAME_STORAGE_KEY, name);
    writeStored(LAST_AVATAR_STORAGE_KEY, avatarSig.value);
    pendingError.value = null;
    const payload: CreateRoomPayload = {
      name,
      avatar: avatarSig.value,
      settings: {},
    };
    emit(ClientEvents.CREATE_ROOM, payload);
  };

  const onJoin = (): void => {
    if (!canJoin) return;
    const name = nameSig.value.trim();
    writeStored(LAST_NAME_STORAGE_KEY, name);
    writeStored(LAST_AVATAR_STORAGE_KEY, avatarSig.value);
    pendingError.value = null;
    // Socket wrapper auto-injects playerToken — leave it off here so the type
    // assignment is straightforward.
    const payload: JoinRoomPayload = {
      roomCode: roomCodeSig.value,
      name,
      avatar: avatarSig.value,
    };
    emit(ClientEvents.JOIN_ROOM, payload);
  };

  const toggleJoinPanel = (): void => {
    joinModeSig.value = !joinModeSig.value;
  };

  return (
    <main class={styles.root}>
      <h1 class={styles.title}>UNO</h1>

      <section class={styles.section} aria-labelledby="name-label">
        <label id="name-label" class={styles.label} for="player-name">
          Your name
        </label>
        <input
          id="player-name"
          class={styles.nameInput}
          type="text"
          value={nameSig.value}
          maxLength={NAME_MAX}
          placeholder={`${NAME_MIN}–${NAME_MAX} characters`}
          autoComplete="nickname"
          onInput={onNameInput}
        />
        <div class={styles.nameError} aria-live="polite">
          {nameValidation.value.error ?? ''}
        </div>
      </section>

      <section class={styles.section} aria-labelledby="avatar-label">
        <div id="avatar-label" class={styles.label}>
          Pick an avatar
        </div>
        <div class={styles.avatarGrid} role="radiogroup">
          {AVATARS.map((name) => {
            const Icon = AVATAR_ICONS[name];
            const selected = avatarSig.value === name;
            return (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={name}
                class={`${styles.avatarSwatch} ${selected ? styles.avatarSelected : ''}`}
                onClick={() => {
                  avatarSig.value = name;
                }}
              >
                <Icon size={28} />
              </button>
            );
          })}
        </div>
      </section>

      <section class={styles.section}>
        <div class={styles.ctaRow}>
          <button
            type="button"
            class="primary"
            disabled={!canCreate}
            onClick={onCreate}
          >
            Create Room
          </button>
          <button
            type="button"
            disabled={!canCreate}
            onClick={toggleJoinPanel}
            aria-expanded={joinModeSig.value}
          >
            Join Room
          </button>
        </div>
        {joinModeSig.value ? (
          <div class={styles.joinPanel}>
            <label class={styles.label} for="room-code">
              Room code
            </label>
            <div class={styles.joinRow}>
              <input
                id="room-code"
                class={styles.codeInput}
                type="text"
                value={roomCodeSig.value}
                maxLength={ROOM_CODE_LEN}
                placeholder="ABC123"
                autoCapitalize="characters"
                spellcheck={false}
                onInput={onCodeInput}
              />
              <button
                type="button"
                class="primary"
                disabled={!canJoin}
                onClick={onJoin}
              >
                Join
              </button>
            </div>
            <div class={styles.nameError} aria-live="polite">
              {codeValidation.value.error ?? ''}
            </div>
            <div class={styles.hint}>
              Share a room link or type the 6-character code.
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
