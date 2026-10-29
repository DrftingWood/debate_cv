/*
 * The product's icon set, in one place.
 *
 * Phosphor (MIT) replaced lucide-react in the 2026-10-29 redesign: lucide has
 * one weight, and its glyphs mixed with ad-hoc sizes read as stock. Every
 * Phosphor glyph ships matched weights, and the rule here is:
 *
 *   - `regular` (the default) at 16px and below: inline with text, row
 *     actions, pills;
 *   - `weight="light"` at 20px and above: nav, buttons, empty states;
 *   - `duotone` only for large empty-state art, if ever.
 *
 * Each icon is imported from its own file in Phosphor's `dist/ssr` build:
 *   - `ssr` is the build without React context, so the same icon works in a
 *     Server Component and a client one (the package root uses context and
 *     fails in a Server Component);
 *   - one file per icon, not the `/ssr` index, because the index pulls in
 *     all ~1,500 icon modules wherever nothing tree-shakes. Under Vitest that
 *     cost each worker seconds and timed out two render tests; it would cost
 *     `next dev` the same on every cold compile.
 * Everything goes through this file; eslint `no-restricted-imports` blocks
 * `lucide-react` and direct Phosphor imports elsewhere. To add an icon, add
 * one line here.
 *
 * Label first (UI_UX_STANDARDS UX-46, UX-72): an icon beside a debate idea
 * is decoration under its text label; icon-only controls are limited to
 * universal glyphs, each with an accessible name.
 *
 * Debate ideas no library draws live in ./DebateMarks, on Phosphor's grid.
 */
export { ArrowClockwise } from '@phosphor-icons/react/dist/ssr/ArrowClockwise';
export { ArrowCounterClockwise } from '@phosphor-icons/react/dist/ssr/ArrowCounterClockwise';
export { ArrowRight } from '@phosphor-icons/react/dist/ssr/ArrowRight';
export { ArrowSquareOut } from '@phosphor-icons/react/dist/ssr/ArrowSquareOut';
export { ArrowUp } from '@phosphor-icons/react/dist/ssr/ArrowUp';
export { ArrowUpRight } from '@phosphor-icons/react/dist/ssr/ArrowUpRight';
export { ArrowsClockwise } from '@phosphor-icons/react/dist/ssr/ArrowsClockwise';
export { Bell } from '@phosphor-icons/react/dist/ssr/Bell';
export { CaretDown } from '@phosphor-icons/react/dist/ssr/CaretDown';
export { Chair } from '@phosphor-icons/react/dist/ssr/Chair';
export { ChartBar } from '@phosphor-icons/react/dist/ssr/ChartBar';
export { Check } from '@phosphor-icons/react/dist/ssr/Check';
export { CheckCircle } from '@phosphor-icons/react/dist/ssr/CheckCircle';
export { CircleNotch } from '@phosphor-icons/react/dist/ssr/CircleNotch';
export { Clock } from '@phosphor-icons/react/dist/ssr/Clock';
export { Compass } from '@phosphor-icons/react/dist/ssr/Compass';
export { Copy } from '@phosphor-icons/react/dist/ssr/Copy';
export { Database } from '@phosphor-icons/react/dist/ssr/Database';
export { DownloadSimple } from '@phosphor-icons/react/dist/ssr/DownloadSimple';
export { Envelope } from '@phosphor-icons/react/dist/ssr/Envelope';
export { Flag } from '@phosphor-icons/react/dist/ssr/Flag';
export { Gear } from '@phosphor-icons/react/dist/ssr/Gear';
export { Info } from '@phosphor-icons/react/dist/ssr/Info';
export { Link } from '@phosphor-icons/react/dist/ssr/Link';
export { Lock } from '@phosphor-icons/react/dist/ssr/Lock';
export { LockOpen } from '@phosphor-icons/react/dist/ssr/LockOpen';
export { MagnifyingGlass } from '@phosphor-icons/react/dist/ssr/MagnifyingGlass';
export { Moon } from '@phosphor-icons/react/dist/ssr/Moon';
export { PaperPlaneTilt } from '@phosphor-icons/react/dist/ssr/PaperPlaneTilt';
export { Play } from '@phosphor-icons/react/dist/ssr/Play';
export { Printer } from '@phosphor-icons/react/dist/ssr/Printer';
export { Prohibit } from '@phosphor-icons/react/dist/ssr/Prohibit';
export { Quotes } from '@phosphor-icons/react/dist/ssr/Quotes';
export { ShareNetwork } from '@phosphor-icons/react/dist/ssr/ShareNetwork';
export { Shield } from '@phosphor-icons/react/dist/ssr/Shield';
export { ShieldCheck } from '@phosphor-icons/react/dist/ssr/ShieldCheck';
export { SignOut } from '@phosphor-icons/react/dist/ssr/SignOut';
export { SlidersHorizontal } from '@phosphor-icons/react/dist/ssr/SlidersHorizontal';
export { Sparkle } from '@phosphor-icons/react/dist/ssr/Sparkle';
export { Star } from '@phosphor-icons/react/dist/ssr/Star';
export { Stop } from '@phosphor-icons/react/dist/ssr/Stop';
export { Sun } from '@phosphor-icons/react/dist/ssr/Sun';
export { Table } from '@phosphor-icons/react/dist/ssr/Table';
export { Trash } from '@phosphor-icons/react/dist/ssr/Trash';
export { Tray } from '@phosphor-icons/react/dist/ssr/Tray';
export { UploadSimple } from '@phosphor-icons/react/dist/ssr/UploadSimple';
export { UserCheck } from '@phosphor-icons/react/dist/ssr/UserCheck';
export { UserFocus } from '@phosphor-icons/react/dist/ssr/UserFocus';
export { Users } from '@phosphor-icons/react/dist/ssr/Users';
export { Warning } from '@phosphor-icons/react/dist/ssr/Warning';
export { WarningCircle } from '@phosphor-icons/react/dist/ssr/WarningCircle';
export { X } from '@phosphor-icons/react/dist/ssr/X';
export { XCircle } from '@phosphor-icons/react/dist/ssr/XCircle';

export { BreakMark, ChampionMark, CoreMark, MajorMark, SpeakerMark } from './DebateMarks';
