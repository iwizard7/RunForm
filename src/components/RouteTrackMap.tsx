'use client';

import React, { useMemo } from 'react';
import { RoutePoint } from '@/lib/parser';
import { WorkoutSplit } from '@/lib/splits';
import { PACE_STOPS, buildTrackGeometry } from '@/lib/track';
import { Language } from '@/lib/translations';

type RouteTrackMapProps = {
  route: RoutePoint[];
  splits: WorkoutSplit[];
  lang: Language;
};

/**
 * Offline SVG rendering of the recorded GPS track: pace-coloured polyline
 * with start/finish markers. No map tiles — the app must work without
 * internet, and runs are local enough for a plain geometry view.
 */
export function RouteTrackMap({ route, splits, lang }: RouteTrackMapProps) {
  const geometry = useMemo(() => buildTrackGeometry(route, splits), [route, splits]);

  if (!geometry) return null;

  const splitPaces = splits.filter((split) => split.paceSec !== undefined);
  const hasPaceLegend = splitPaces.length > 1;

  return (
    <div style={{ marginBottom: '14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', gap: '12px' }}>
        <p className="secondary-text" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
          {lang === 'ru' ? 'Маршрут' : 'Route'}
        </p>
        {hasPaceLegend && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.7rem' }} className="secondary-text">
            <span>{lang === 'ru' ? 'быстрее' : 'faster'}</span>
            <span
              style={{
                width: '90px',
                height: '6px',
                borderRadius: '999px',
                background: `linear-gradient(90deg, ${PACE_STOPS.join(', ')})`,
              }}
            />
            <span>{lang === 'ru' ? 'медленнее' : 'slower'}</span>
          </div>
        )}
      </div>

      <svg
        viewBox={`0 0 640 340`}
        width="100%"
        style={{ display: 'block', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '14px' }}
        role="img"
        aria-label={lang === 'ru' ? 'Карта GPS-трека тренировки' : 'Workout GPS track map'}
      >
        {geometry.paths.map((path, index) => (
          <path
            key={index}
            d={path.d}
            fill="none"
            stroke={path.color}
            strokeWidth={4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        <circle cx={geometry.start.x} cy={geometry.start.y} r={7} fill="#34c759" stroke="#0b0f14" strokeWidth={2} />
        <circle cx={geometry.end.x} cy={geometry.end.y} r={7} fill="#ff3b30" stroke="#0b0f14" strokeWidth={2} />
      </svg>

      <p className="secondary-text" style={{ fontSize: '0.75rem', marginTop: '6px' }}>
        {lang === 'ru'
          ? `${geometry.pointCount} GPS-точек · зелёная точка — старт, красная — финиш`
          : `${geometry.pointCount} GPS points · green dot — start, red — finish`}
      </p>
    </div>
  );
}
