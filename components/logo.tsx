export function Logo({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="currentColor" d="M24 3 6 10v12c0 10.4 7.3 18.7 18 22 10.7-3.3 18-11.6 18-22V10L24 3z" />
      <path fill="#f4efe6" d="M16 20h16v3H27v12h-6V23h-5v-3z" />
      <path fill="#9a3412" d="M22 26h4v3h-4z" />
    </svg>
  );
}
