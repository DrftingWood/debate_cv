/**
 * The route cross-fade for the signed-in app (redesign owner decision 23):
 * Next remounts a template on every navigation, so each page fades in over
 * 200 ms. Opacity only, so nothing moves and reduced motion keeps it
 * (app/globals.css). A server component: no client JS for a CSS animation.
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="animate-fade-in">{children}</div>;
}
