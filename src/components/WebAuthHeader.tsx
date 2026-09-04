import { useEffect, useRef, useState, type ComponentType } from 'react';
import { useT } from '../i18n';
import type { LegalDoc } from '../legalContent';
import Logo from './Logo';
import {
  IconSave,
  IconFolderOpen,
  IconImage,
  IconVideo,
  IconAssetsFolder,
  IconCrop,
  IconDiamond,
  IconTool,
  IconInfo,
  IconDocument,
  IconCreditCard,
  IconChat,
  IconChevronDown,
} from './Icons';

type MenuKey = 'file' | 'templates' | 'tools' | 'about';

interface RichItem {
  title: string;
  description: string;
  icon: ComponentType<{ size?: number }>;
  onClick: () => void;
}

type MenuEntry = RichItem | { type: 'header'; label: string };

interface WebAuthHeaderProps {
  onSignIn: () => void;
  onSignUp: () => void;
  onOpenLegal: (doc: LegalDoc) => void;
}

// Visually ported from a shadcn/Tailwind "Header" reference component (NavigationMenu with
// icon+title+description dropdown cards) onto ONEFLOW's own --c-* token system — no
// Tailwind/shadcn/Radix here, same porting approach as the login screen and glow-menu earlier.
// This sits only on the logged-out login/register screen (WebAuthGate) as a lightweight preview
// of what's inside the product; the in-app authenticated toolbar keeps its own plain File/
// Templates/Tools dropdowns untouched. Every item nudges a visitor toward signing up, since
// none of these destinations exist before a session does.
export default function WebAuthHeader({ onSignIn, onSignUp, onOpenLegal }: WebAuthHeaderProps) {
  const t = useT();
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const navRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenu) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openMenu]);

  const toggleMenu = (key: MenuKey) => setOpenMenu((cur) => (cur === key ? null : key));

  const fileItems: MenuEntry[] = [
    { title: t.toolbar.saveProject, description: t.landingHeader.saveProjectDesc, icon: IconSave, onClick: onSignUp },
    { title: t.toolbar.openProject, description: t.landingHeader.openProjectDesc, icon: IconFolderOpen, onClick: onSignUp },
  ];

  const templateItems: MenuEntry[] = [
    { type: 'header', label: t.landingHeader.templatesForBusinessGroup },
    { title: t.startScreen.businessHoreca, description: t.landingHeader.horecaDesc, icon: IconImage, onClick: onSignUp },
    { title: t.startScreen.businessAuto, description: t.landingHeader.autoDesc, icon: IconVideo, onClick: onSignUp },
    { title: t.startScreen.businessApartment, description: t.landingHeader.apartmentDesc, icon: IconAssetsFolder, onClick: onSignUp },
    { title: t.startScreen.businessFurniture, description: t.landingHeader.furnitureDesc, icon: IconCrop, onClick: onSignUp },
    { title: t.startScreen.businessElectronics, description: t.landingHeader.electronicsDesc, icon: IconDiamond, onClick: onSignUp },
    { type: 'header', label: t.landingHeader.templatesMarketplacesGroup },
  ];

  const toolItems: MenuEntry[] = [
    { title: t.tools.bgRemoverLabel, description: t.landingHeader.bgRemoverDesc, icon: IconCrop, onClick: onSignUp },
    { title: t.tools.upscalerLabel, description: t.landingHeader.upscalerDesc, icon: IconDiamond, onClick: onSignUp },
    { title: t.tools.photoEditorLabel, description: t.landingHeader.photoEditorDesc, icon: IconImage, onClick: onSignUp },
  ];

  const aboutItems: MenuEntry[] = [
    { title: t.legal.privacyLink, description: t.landingHeader.privacyDesc, icon: IconInfo, onClick: () => onOpenLegal('privacy') },
    { title: t.legal.termsLink, description: t.landingHeader.termsDesc, icon: IconDocument, onClick: () => onOpenLegal('terms') },
    { title: t.legal.refundLink, description: t.landingHeader.refundDesc, icon: IconCreditCard, onClick: () => onOpenLegal('refund') },
    { title: t.legal.helpLink, description: t.landingHeader.helpDesc, icon: IconChat, onClick: () => onOpenLegal('help') },
  ];

  const menus: { key: MenuKey; label: string; items: MenuEntry[]; wide?: boolean }[] = [
    { key: 'file', label: t.toolbar.file, items: fileItems },
    { key: 'templates', label: t.toolbar.templates, items: templateItems, wide: true },
    { key: 'tools', label: t.tools.menuLabel, items: toolItems },
    { key: 'about', label: t.landingHeader.aboutMenuLabel, items: aboutItems },
  ];

  return (
    <header className="landing-header">
      <div className="landing-header-inner" ref={navRef}>
        <div className="landing-header-left">
          <span className="landing-header-logo">
            <Logo />
          </span>
          <nav className="landing-header-nav">
            {menus.map((menu) => (
              <div key={menu.key} className="landing-header-menu-wrap">
                <button
                  type="button"
                  className={`landing-header-trigger ${openMenu === menu.key ? 'open' : ''}`}
                  onClick={() => toggleMenu(menu.key)}
                >
                  {menu.label}
                  <IconChevronDown size={13} />
                </button>
                {openMenu === menu.key && (
                  <div className={`landing-header-panel ${menu.wide ? 'wide' : ''}`}>
                    {menu.items.map((item, i) =>
                      'type' in item ? (
                        <div key={i} className="landing-header-panel-header">
                          {item.label}
                        </div>
                      ) : (
                        <button
                          key={i}
                          type="button"
                          className="landing-header-item"
                          onClick={() => {
                            item.onClick();
                            setOpenMenu(null);
                          }}
                        >
                          <span className="landing-header-item-icon">
                            <item.icon size={18} />
                          </span>
                          <span className="landing-header-item-text">
                            <span className="landing-header-item-title">{item.title}</span>
                            <span className="landing-header-item-desc">{item.description}</span>
                          </span>
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>
            ))}
          </nav>
        </div>
        <div className="landing-header-right">
          <button type="button" className="landing-header-signin" onClick={onSignIn}>
            {t.landingHeader.signInBtn}
          </button>
          <button type="button" className="landing-header-signup" onClick={onSignUp}>
            {t.landingHeader.signUpBtn}
          </button>
        </div>
      </div>
    </header>
  );
}
