import { IconAssetsFolder, IconHome, IconUser } from './Icons';
import Logo from './Logo';
import type { AppView, ModeDef } from '../modes';
import { useT } from '../i18n';

interface AppSidebarProps {
  modes: ModeDef[];
  active: AppView;
  onSelect: (view: AppView) => void;
  onProfile: () => void;
}

// Web-only icon rail on the left: Главная + every mode (the same list as the home tiles and the
// header search, see modes.ts), Ассеты and the profile at the bottom. Labels live in title /
// aria-label and in a hover tooltip, so the rail stays narrow.
export default function AppSidebar({ modes, active, onSelect, onProfile }: AppSidebarProps) {
  const t = useT();
  const item = (view: AppView, label: string, Icon: ModeDef['icon']) => (
    <button
      key={view}
      type="button"
      className={`app-rail-btn${active === view ? ' active' : ''}`}
      onClick={() => onSelect(view)}
      aria-label={label}
      aria-current={active === view ? 'page' : undefined}
      data-tip={label}
    >
      <Icon size={19} />
    </button>
  );
  return (
    <nav className="app-rail" aria-label="ONEFLOW">
      <button type="button" className="app-rail-logo" onClick={() => onSelect('home')} aria-label={t.home.navLabel}>
        <Logo className="app-rail-logo-img" />
      </button>
      <div className="app-rail-group">
        {item('home', t.home.navLabel, IconHome)}
        <span className="app-rail-sep" aria-hidden="true" />
        {modes.map((m) => item(m.value, m.label, m.icon))}
      </div>
      <div className="app-rail-group app-rail-bottom">
        {item('assets', t.home.assets, IconAssetsFolder)}
        <button type="button" className="app-rail-btn" onClick={onProfile} aria-label={t.home.profile} data-tip={t.home.profile}>
          <IconUser size={19} />
        </button>
      </div>
    </nav>
  );
}
