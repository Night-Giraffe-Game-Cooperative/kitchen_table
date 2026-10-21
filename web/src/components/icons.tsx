// Line icons drawn for this app, 24 units square, in the current text colour.
import type { ReactNode, SVGProps } from 'react';

const paths = {
  chat: <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5z" />,
  games: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3.5" />
      <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" />
      <circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
      <circle cx="15.5" cy="8.5" r="1.2" fill="currentColor" />
      <circle cx="8.5" cy="15.5" r="1.2" fill="currentColor" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 19.5c.6-3.4 3-5.5 6-5.5s5.4 2.1 6 5.5" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M16.5 14c2.4.2 4 1.9 4.5 4.6" />
    </>
  ),
  me: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20c.8-4 3.8-6.3 7.5-6.3s6.7 2.3 7.5 6.3" />
    </>
  ),
  send: <path d="M4 12 20 4l-6 16-2.5-6.5zM11.5 13.5 20 4" />,
  photo: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="m3.5 17.5 5-4.5 3.5 3 3-2.5 5.5 4.5" />
    </>
  ),
  brush: (
    <>
      <path d="M14.5 4.5 19.5 9.5 11 18l-5-5z" />
      <path d="M6 13c-2 0-3 1.5-3 3.5S2.5 20 2.5 20s4 .5 5.5-1 1.5-3 1-4" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  back: <path d="m14.5 5-7 7 7 7" />,
  forward: <path d="m9.5 5 7 7-7 7" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  undo: <path d="M8.5 6 4 10.5 8.5 15M4.5 10.5H14a5.5 5.5 0 0 1 0 11h-3" />,
  redo: <path d="M15.5 6 20 10.5 15.5 15M19.5 10.5H10a5.5 5.5 0 0 0 0 11h3" />,
  trash: <path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l1 13h9l1-13M10 10.5v6M14 10.5v6" />,
  speaker: <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />,
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="2" />,
  reply: <path d="M9.5 6 4 11.5 9.5 17M4.5 11.5H14c3.6 0 6 2.4 6 6v1" />,
  smile: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 14.2a4.2 4.2 0 0 0 7 0" />
      <circle cx="9.3" cy="9.8" r=".9" fill="currentColor" />
      <circle cx="14.7" cy="9.8" r=".9" fill="currentColor" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  eraser: (
    <>
      <path d="m9 19.5-4.5-4.5a2 2 0 0 1 0-2.8l8-8a2 2 0 0 1 2.8 0l4 4a2 2 0 0 1 0 2.8l-8.5 8.5z" />
      <path d="M9 19.5h11M8 9l7 7" />
    </>
  ),
  marker: (
    <>
      <path d="m15 3.5 5.5 5.5-9 9H6v-5.5z" />
      <path d="M6 18 3.5 20.5" />
    </>
  ),
  pen: <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z" />,
  star: <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" />,
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.4" fill="currentColor" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.4" fill="currentColor" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m4 7 8 6 8-6" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 8.5-8.5M16 7l2.5 2.5M14 9l2 2" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </>
  ),
  crown: <path d="M4 18.5h16M4.5 16 3.5 7l5 4L12 5l3.5 6 5-4-1 9z" />,
  sparkle: <path d="M12 3c.5 4.5 2.5 6.5 7 7-4.5.5-6.5 2.5-7 7-.5-4.5-2.5-6.5-7-7 4.5-.5 6.5-2.5 7-7zM19 15c.2 1.8 1 2.6 2.5 2.8-1.5.2-2.3 1-2.5 2.7-.2-1.7-1-2.5-2.5-2.7 1.5-.2 2.3-1 2.5-2.8z" />,
  refresh: <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>
  ),
  moon: <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" />,
  device: (
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="2" />
      <path d="M9 20h6M12 16.5V20" />
    </>
  ),
  logout: <path d="M14 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H14M10 12h10M16.5 8.5 20 12l-3.5 3.5" />,
  camera: (
    <>
      <path d="M4 8a2 2 0 0 1 2-2h2l1.5-2h5L16 6h2a2 2 0 0 1 2 2v9.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="12.5" r="3.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  shield: <path d="M12 3.5 5 6v5.5c0 4.3 3 7.7 7 9 4-1.3 7-4.7 7-9V6z" />,
  heart: <path d="M12 19.5s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 6.8a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10-7.5 10z" />,
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  book: <path d="M4 5.5c2.5-1 5.5-1 8 .5 2.5-1.5 5.5-1.5 8-.5v13c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5zM12 6v13" />,
  flower: (
    <>
      <circle cx="12" cy="9" r="2.2" />
      <path d="M12 6.8c0-2.5 3.5-2.5 3.5 0M14.2 9c2.5 0 2.5 3.5 0 3.5M12 11.2c0 2.5-3.5 2.5-3.5 0M9.8 9c-2.5 0-2.5-3.5 0-3.5M12 11.5V21M12 17c-1.5-2.5-4-3-5.5-2.5M12 16c1.5-2 3.5-2.5 5-2" />
    </>
  ),
  dice: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3.5" />
      <circle cx="8.5" cy="8.5" r="1.3" fill="currentColor" />
      <circle cx="15.5" cy="15.5" r="1.3" fill="currentColor" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  bell: <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0" />,
  download: <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />,
  quiet: <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0M4 4l16 16" />,
  robot: (
    <>
      <rect x="4.5" y="8" width="15" height="11" rx="3" />
      <path d="M12 8V4.5M9 13h.01M15 13h.01M9.5 16h5" />
      <circle cx="12" cy="4" r="1" />
    </>
  ),
  team: (
    <>
      <circle cx="7" cy="9" r="2.5" />
      <circle cx="17" cy="9" r="2.5" />
      <circle cx="12" cy="7" r="2.8" />
      <path d="M2.5 18c.4-2.5 2-4 4.5-4M21.5 18c-.4-2.5-2-4-4.5-4M7 19.5c.5-3.2 2.4-5 5-5s4.5 1.8 5 5" />
    </>
  ),
  video: (
    <>
      <rect x="2.5" y="6" width="13" height="12" rx="2.5" />
      <path d="m15.5 10.5 6-3.5v10l-6-3.5" />
    </>
  ),
  'video-off': (
    <>
      <path d="M8 6h5a2.5 2.5 0 0 1 2.5 2.5v2l6-3.5v10l-3.5-2M15.5 16.5A2.5 2.5 0 0 1 13 18H5a2.5 2.5 0 0 1-2.5-2.5v-7A2.5 2.5 0 0 1 4.5 6" />
      <path d="m3 3 18 18" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
    </>
  ),
  'mic-off': (
    <>
      <path d="M15 10V6a3 3 0 0 0-5.6-1.5M9 9v2a3 3 0 0 0 4.8 2.4M5.5 11a6.5 6.5 0 0 0 10.6 5M18.4 12.5c.1-.5.1-1 .1-1.5M12 17.5V21M8.5 21h7" />
      <path d="m3 3 18 18" />
    </>
  ),
  phone: (
    <path d="M6.6 3.5h2.6l1.6 4.2-2 1.3a11.5 11.5 0 0 0 6.2 6.2l1.3-2 4.2 1.6v2.6a2.1 2.1 0 0 1-2.3 2.1C10.4 19 5 13.6 4.5 5.8a2.1 2.1 0 0 1 2.1-2.3z" />
  ),
  'phone-down': (
    <path d="M3.2 14.6c-.6-.6-.7-1.6-.1-2.2C7.9 7.6 16.1 7.6 20.9 12.4c.6.6.5 1.6-.1 2.2l-1.8 1.8-4-1.6.1-2.4a11.5 11.5 0 0 0-6.2 0l.1 2.4-4 1.6z" />
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
      <circle cx="8.5" cy="14.5" r="1" fill="currentColor" />
      <circle cx="12" cy="14.5" r="1" fill="currentColor" />
    </>
  ),
  list: <path d="M9.5 6.5h10M9.5 12h10M9.5 17.5h10M4.5 6.5l1 1 2-2M4.5 12l1 1 2-2M4.5 17.5l1 1 2-2" />,
  flip: (
    <>
      <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8L10 4h4l1.7 2h1.8A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z" />
      <path d="M9 12.5a3 3 0 0 1 5.2-2M15 12.5a3 3 0 0 1-5.2 2M14.6 9v1.7h-1.7M9.4 16v-1.7h1.7" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 22, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}
