'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Download, LogOut, Trash2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { postJson } from '@/lib/utils/api';

export function DisconnectGoogleButton() {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="secondary"
        leftIcon={<LogOut className="h-4 w-4" aria-hidden />}
        onClick={() => setConfirming(true)}
      >
        Disconnect Google
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[13.5px] text-muted-foreground">
        Revoke the OAuth grant and remove tokens?
      </span>
      <Button
        type="button"
        variant="danger"
        size="sm"
        loading={isPending}
        onClick={() => {
          startTransition(async () => {
            const res = await postJson('/api/account/disconnect');
            if (!res.ok) {
              toast.show({ kind: 'error', title: 'Disconnect failed', description: res.error });
              return;
            }
            toast.show({
              kind: 'success',
              title: 'Disconnected',
              description: 'Google token revoked.',
            });
            router.refresh();
            router.push('/');
          });
        }}
      >
        Yes, disconnect
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
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

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="danger"
        leftIcon={<Trash2 className="h-4 w-4" aria-hidden />}
        onClick={() => setConfirming(true)}
      >
        Delete my data
      </Button>
    );
  }

  const disabled =
    !userEmail || typed.trim().toLowerCase() !== userEmail.toLowerCase() || isPending;

  return (
    <div className="space-y-3 rounded-card border border-[hsl(var(--destructive)/0.22)] bg-[hsl(var(--destructive)/0.06)] p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
        <div>
          <div className="text-[14px] font-semibold text-destructive">
            This permanently deletes your account, URL history, jobs, and claimed identities.
          </div>
          <div className="mt-1 text-caption text-muted-foreground">
            To confirm, type <strong>{userEmail ?? 'your email'}</strong> below. Tournament data
            shared across users stays (it's public tab data).
          </div>
        </div>
      </div>
      <input
        type="email"
        autoComplete="off"
        placeholder={userEmail ?? 'email'}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        className="block w-full rounded-md border border-border bg-card px-3.5 py-2.5 text-[14px] shadow-xs focus:border-destructive focus:outline-none focus:ring-2 focus:ring-destructive/40"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="danger"
          size="sm"
          loading={isPending}
          disabled={disabled}
          onClick={() => {
            startTransition(async () => {
              const res = await postJson('/api/account/delete', { confirmEmail: typed });
              if (!res.ok) {
                toast.show({ kind: 'error', title: 'Delete failed', description: res.error });
                return;
              }
              toast.show({ kind: 'success', title: 'Account deleted' });
              window.location.href = '/';
            });
          }}
        >
          Permanently delete
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setTyped('');
            setConfirming(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
