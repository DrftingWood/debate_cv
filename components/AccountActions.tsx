'use client';

import { useId, useRef, useState, useTransition, type FormEvent, type RefObject } from 'react';
import { useRouter } from 'next/navigation';
import { Download, LogOut, Trash2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { FieldError, describedBy, fieldInputClass } from '@/components/FieldError';
import { useFocusAfterRender } from '@/components/useFocusAfterRender';
import { postJson } from '@/lib/utils/api';
import { userMessage } from '@/lib/ingest/userMessage';
import {
  DELETE_PHRASE,
  deleteConfirmationTarget,
  matchesDeleteConfirmation,
} from '@/lib/account/deleteConfirmation';

/*
 * Both destructive actions on /settings/account follow one pattern (UX-17):
 * an inline confirmation step, no browser confirm() (it cannot be styled,
 * names no consequence and some browsers let the user suppress it), the
 * consequence stated in words before anything happens, focus moved into the
 * step on open and back to the trigger on Cancel (SET-3), and the confirm
 * button `loading` while the request runs so it cannot be sent twice.
 */

export function DisconnectGoogleButton() {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const focusAfterRender = useFocusAfterRender();
  const headingId = useId();

  if (!confirming) {
    return (
      <Button
        ref={triggerRef}
        type="button"
        variant="secondary"
        leftIcon={<LogOut className="h-4 w-4" aria-hidden />}
        onClick={() => {
          setConfirming(true);
          // Cancel is the safe default: Enter on a reflex does nothing harmful.
          focusAfterRender(cancelRef);
        }}
      >
        Disconnect Gmail
      </Button>
    );
  }

  return (
    <div role="group" aria-labelledby={headingId} className="space-y-3">
      <p id={headingId} className="text-ui text-ink">
        <strong className="font-semibold">Disconnect Gmail?</strong> New tournaments stop arriving.
        Your record stays and you stay signed in. You can reconnect at any time.
      </p>
      {error ? (
        <p role="alert" className="text-caption font-medium text-destructive">
          Gmail is still connected. {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="danger"
          size="sm"
          loading={isPending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const res = await postJson('/api/account/disconnect');
              if (!res.ok) {
                setError(userMessage(res).description);
                return;
              }
              toast.show({
                kind: 'success',
                title: 'Gmail disconnected',
                description: 'Your record stays. Reconnect from Settings to import again.',
              });
              router.refresh();
              router.push('/');
            });
          }}
        >
          Disconnect Gmail
        </Button>
        <Button
          ref={cancelRef}
          type="button"
          variant="ghost"
          size="sm"
          disabled={isPending}
          onClick={() => {
            setConfirming(false);
            setError(null);
            focusAfterRender(triggerRef);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function DownloadDataButton() {
  return (
    <Button
      type="button"
      variant="secondary"
      leftIcon={<Download className="h-4 w-4" aria-hidden />}
      onClick={() => {
        window.location.href = '/api/account/export';
      }}
    >
      Download my data (JSON)
    </Button>
  );
}

export function DeleteAccountButton({ userEmail }: { userEmail: string | null }) {
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const focusAfterRender = useFocusAfterRender();

  if (!confirming) {
    return (
      <Button
        ref={triggerRef}
        type="button"
        variant="danger"
        leftIcon={<Trash2 className="h-4 w-4" aria-hidden />}
        onClick={() => {
          setConfirming(true);
          // Typing is harmless, so the field is a safe place for focus to land.
          focusAfterRender(inputRef);
        }}
      >
        Delete my data
      </Button>
    );
  }

  const target = deleteConfirmationTarget(userEmail);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    // Validate on submit, not by disabling the button (UX-16): a disabled
    // button cannot say why it is disabled.
    if (!matchesDeleteConfirmation(typed, userEmail)) {
      setError(
        typed.trim().length === 0
          ? `Type ${target} to confirm`
          : `That does not match. Type ${target} exactly`,
      );
      inputRef.current?.focus();
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await postJson('/api/account/delete', { confirmEmail: typed });
      if (!res.ok) {
        setError(
          res.error === 'email_mismatch'
            ? `That does not match. Type ${target} exactly`
            : `Your account was not deleted. ${userMessage(res).description}`,
        );
        inputRef.current?.focus();
        return;
      }
      toast.show({ kind: 'success', title: 'Account deleted' });
      window.location.href = '/';
    });
  };

  return (
    <DeleteConfirmForm
      target={target}
      usesPhrase={target === DELETE_PHRASE}
      value={typed}
      onChange={setTyped}
      error={error}
      pending={isPending}
      inputRef={inputRef}
      onSubmit={onSubmit}
      onCancel={() => {
        setTyped('');
        setError(null);
        setConfirming(false);
        focusAfterRender(triggerRef);
      }}
    />
  );
}

/**
 * The confirmation step itself, kept stateless so the markup (label, hint,
 * error wiring) can be server-rendered in a test (SET-1).
 */
export function DeleteConfirmForm({
  target,
  usesPhrase,
  value,
  onChange,
  error,
  pending,
  inputRef,
  onSubmit,
  onCancel,
}: {
  target: string;
  usesPhrase: boolean;
  value: string;
  onChange: (next: string) => void;
  error: string | null;
  pending: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  onSubmit: (e: FormEvent) => void;
  onCancel: () => void;
}) {
  const id = 'delete-confirm';
  return (
    <form
      noValidate
      onSubmit={onSubmit}
      aria-labelledby={`${id}-heading`}
      className="space-y-3 rounded-card border border-[hsl(var(--destructive)/0.4)] bg-[hsl(var(--destructive)/0.06)] p-4"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
        <div id={`${id}-warning`} className="space-y-1">
          <p id={`${id}-heading`} className="text-ui font-semibold text-destructive">
            This permanently deletes your account. It cannot be undone.
          </p>
          <p className="text-caption text-ink-soft">
            Your sign-in, Gmail connection, tournament links, imports, claimed names and public link
            are removed. Tournament results shared by other users stay, because they are public tab
            data.
          </p>
        </div>
      </div>
      <div className="space-y-1.5">
        <label htmlFor={id} className="block text-ui font-medium text-ink">
          {usesPhrase ? (
            <>
              Type <strong>{target}</strong> to confirm
            </>
          ) : (
            <>
              Type your email address, <strong className="break-all">{target}</strong>, to confirm
            </>
          )}
        </label>
        {usesPhrase ? (
          <p id={`${id}-hint`} className="text-caption text-ink-soft">
            Your account has no email address on file, so type the word instead.
          </p>
        ) : null}
        {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
        <input
          ref={inputRef}
          id={id}
          name="confirm"
          type={usesPhrase ? 'text' : 'email'}
          inputMode={usesPhrase ? 'text' : 'email'}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(
            `${id}-warning`,
            usesPhrase && `${id}-hint`,
            error && `${id}-error`,
          )}
          className={fieldInputClass}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="danger" size="sm" loading={pending}>
          Permanently delete my account
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
