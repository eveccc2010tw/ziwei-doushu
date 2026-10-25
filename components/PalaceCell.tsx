'use client';
import { motion } from 'framer-motion';
import type { Palace, Star } from '@/lib/ziwei/types';
import { STEMS, BRANCHES } from '@/lib/ziwei/constants';
import clsx from 'clsx';

interface PalaceCellProps {
  palace: Palace;
  onClick?: () => void;
  onStarClick?: (star: Star) => void;
  isSelected?: boolean;
  isSanFang?: boolean;
  delay?: number;
  /** 叠加四化：星名 → 四化类型（'禄'/'权'/'科'/'忌'） */
  overlayStarSiHua?: Record<string, string>;
  /** 叠加标签：'年'（流年）或 '限'（大限） */
  overlayLabel?: string;
  /** 点击叠加四化 badge 回调 */
  onSiHuaClick?: (starName: string, siHua: string) => void;
}

const SIHUA_STYLES: Record<string, string> = {
  '禄': 'text-emerald-500 bg-emerald-500/10 border-emerald-500/40',
  '权': 'text-blue-500 bg-blue-500/10 border-blue-500/40',
  '科': 'text-yellow-600 bg-yellow-500/10 border-yellow-500/40',
  '忌': 'text-red-500 bg-red-500/10 border-red-500/40',
};

const STAR_COLOR: Record<NonNullable<Star['brightness']>, string> = {
  bright: 'var(--t-star-bright)',
  normal: 'var(--t-star)',
  dim: 'var(--t-star-dim)',
};

const SiHuaBadge = ({
  siHua,
  overlay,
  label,
  onClick,
}: {
  siHua: string;
  overlay?: boolean;
  label?: string;
  onClick?: (e: React.MouseEvent) => void;
}) => {
  return (
    <span
      className={clsx(
        'inline-flex items-center text-fs-9 px-1 rounded-full border leading-none py-px font-bold ml-1 flex-shrink-0',
        SIHUA_STYLES[siHua],
        overlay && 'border-dashed opacity-80',
        onClick && 'cursor-pointer hover:opacity-100',
      )}
      onClick={onClick}
    >
      {overlay && label && <span className="mr-px opacity-70">{label}</span>}
      {siHua}
    </span>
  );
};

export default function PalaceCell({
  palace, onClick, onStarClick, isSelected, isSanFang, delay = 0,
  overlayStarSiHua, overlayLabel, onSiHuaClick,
}: PalaceCellProps) {
  const { branch, stem, name, stars, daXianAge, isCurrentDaXian, isMingGong, isShenGong } = palace;
  const ganzhi = `${STEMS[stem]}${BRANCHES[branch]}`;

  const majorStars = stars.filter(s => s.type === 'major');
  const luckyStars = stars.filter(s => s.type === 'lucky');
  const shaStars = stars.filter(s => s.type === 'sha');

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, delay, ease: 'easeOut' }}
      onClick={onClick}
      className="relative flex flex-col px-2 pt-1.5 pb-1 cursor-pointer transition-all duration-200 h-full"
      style={{
        minHeight: 'calc(128px * var(--t-fs, 1))',
        background: isCurrentDaXian
          ? 'rgba(147,51,234,0.08)'
          : isSelected
          ? 'rgba(37,99,235,0.18)'
          : isSanFang
          ? 'rgba(37,99,235,0.09)'
          : isMingGong
          ? 'rgba(212,168,67,0.07)'
          : 'var(--t-bg)',
        boxShadow: isCurrentDaXian
          ? 'inset 3px 0 0 rgba(147,51,234,0.5)'
          : isSelected
          ? 'inset 0 0 0 1.5px rgba(37,99,235,0.7)'
          : isSanFang
          ? 'inset 0 0 0 1px rgba(37,99,235,0.4)'
          : 'none',
      }}
    >
      {/* 主星（含亮度） */}
      <div className="flex flex-col gap-0.5">
        {majorStars.length === 0 && (
          <span className="text-fs-11 italic" style={{ color: 'var(--t-faint)', opacity: 0.7 }}>空宫</span>
        )}
        {majorStars.map((star) => {
          const overlaySiHua = overlayStarSiHua?.[star.name];
          return (
            <div
              key={star.name}
              className="flex items-center"
              onClick={e => { e.stopPropagation(); onStarClick?.(star); }}
            >
              <span
                className="text-fs-15 leading-tight font-bold tracking-wide cursor-pointer hover:brightness-125 transition-all"
                style={{ color: STAR_COLOR[star.brightness ?? 'normal'] }}
              >
                {star.name}
              </span>
              {star.brightnessRaw && (
                <span className="text-fs-9 ml-0.5 self-end leading-none pb-px" style={{ color: 'var(--t-faint)' }}>
                  {star.brightnessRaw}
                </span>
              )}
              {star.siHua && <SiHuaBadge siHua={star.siHua} />}
              {overlaySiHua && (
                <SiHuaBadge
                  siHua={overlaySiHua}
                  overlay
                  label={overlayLabel}
                  onClick={e => {
                    e.stopPropagation();
                    onSiHuaClick?.(star.name, overlaySiHua);
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* 吉星 */}
      {luckyStars.length > 0 && (
        <div className="flex flex-wrap gap-x-1.5 mt-1">
          {luckyStars.map(s => {
            const overlaySiHua = overlayStarSiHua?.[s.name];
            return (
              <span key={s.name} className="inline-flex items-center text-fs-11 leading-snug" style={{ color: 'var(--t-lucky)' }}>
                {s.name}
                {s.siHua && <SiHuaBadge siHua={s.siHua} />}
                {overlaySiHua && (
                  <SiHuaBadge
                    siHua={overlaySiHua}
                    overlay
                    label={overlayLabel}
                    onClick={e => {
                      e.stopPropagation();
                      onSiHuaClick?.(s.name, overlaySiHua);
                    }}
                  />
                )}
              </span>
            );
          })}
        </div>
      )}

      {/* 煞星 */}
      {shaStars.length > 0 && (
        <div className="flex flex-wrap gap-x-1.5">
          {shaStars.map(s => (
            <span key={s.name} className="inline-flex items-center text-fs-11 leading-snug" style={{ color: 'var(--t-sha)' }}>
              {s.name}{s.siHua && <SiHuaBadge siHua={s.siHua} />}
            </span>
          ))}
        </div>
      )}

      {/* 底部：干支（左）；大限年龄＋宫名（右） */}
      <div className="mt-auto pt-1 flex items-end justify-between gap-1">
        <span className="text-fs-10 font-mono" style={{ color: 'var(--t-faint)' }}>{ganzhi}</span>
        <span className="flex flex-col items-end">
          {daXianAge && (
            <span
              className={clsx('text-fs-10 font-mono tabular-nums', isCurrentDaXian && 'text-purple-400 font-semibold')}
              style={!isCurrentDaXian ? { color: 'var(--t-faint)' } : undefined}
            >
              {daXianAge[0]}–{daXianAge[1]}
            </span>
          )}
          <span className="flex items-center gap-1">
            {isShenGong && (
              <span className="text-fs-9 text-sky-500 border border-sky-500/40 px-0.5 rounded leading-tight">身</span>
            )}
            <span
              className={clsx('text-fs-12 font-semibold tracking-wider',
                isMingGong ? 'text-amber-500' : isShenGong ? 'text-sky-500' : ''
              )}
              style={!isMingGong && !isShenGong ? { color: 'var(--t-text2)' } : undefined}
            >
              {name}
            </span>
          </span>
        </span>
      </div>

    </motion.div>
  );
}
