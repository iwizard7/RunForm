"use client";

import NextImage from 'next/image';
import React, { useRef, useState } from 'react';
import {
  Activity,
  History as HistoryIcon,
  TrendingUp,
  Settings,
  Upload,
  Heart,
  Zap,
  Timer,
  MapPin,
  Flame,
  Wind,
  Languages,
  CalendarDays,
  Download,
  Target,
  BarChart3,
  ShieldAlert,
  Gauge,
  FileText,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Share2,
  Sparkles,
  Loader2,
  Footprints,
  Tag,
  Plus,
  X,
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  AreaChart,
  Area,
} from 'recharts';
import { WorkoutData } from '@/lib/parser';
import { getEfficiencyMetrics, getIntensityScore, MetricExplainerKey } from '@/lib/ai';
import { Language } from '@/lib/translations';
import { buildHomeMetrics, formatTime, getDateKey } from '@/lib/home-metrics';
import { useWorkoutData } from '@/hooks/useWorkoutData';
import { useAiCoach } from '@/hooks/useAiCoach';
import { useWorkoutExports } from '@/hooks/useWorkoutExports';
import { VersusSummaryCard } from '@/components/ai/VersusSummaryCard';
import { AiCoachDashboard } from '@/components/ai/AiCoachDashboard';
import { NextWorkoutInsights } from '@/components/ai/NextWorkoutInsights';
import { ShareCardModal } from '@/components/share/ShareCardModal';
import { ComparisonRow, DetailRow, MetricLabel, SidebarItem } from '@/components/ui/AppPrimitives';

const APP_VERSION = '0.4.2';

export default function Home() {
  const {
    workout,
    setWorkout,
    history,
    shoes,
    loadShoes,
    isClient,
    profileName,
    setProfileName,
    currentMonth,
    setCurrentMonth,
    selectedDateKey,
    setSelectedDateKey,
    preferences,
    setPreferences,
    assignShoe,
    updateTags,
    importWorkoutFile,
    resetWorkouts,
  } = useWorkoutData();

  const [newShoe, setNewShoe] = useState({ name: '', brand: '', model: '', maxDistance: 800 });
  const [activeTab, setActiveTab] = useState('dashboard');
  const [lang, setLang] = useState<Language>('ru');
  const [tagFilter, setTagFilter] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedWorkouts, setSelectedWorkouts] = useState<WorkoutData[]>([]);
  const [selectedMetricKey, setSelectedMetricKey] = useState<MetricExplainerKey>('metLoad');

  const {
    showShareCard,
    setShowShareCard,
    isShareSaving,
    isReportSaving,
    shareCardRef,
    dashboardExportRef,
    reportCardRef,
    handleExport,
    handleSaveShareCard,
    handleSaveReportCard,
    handleExportReportPdf,
  } = useWorkoutExports(workout, lang);

  const {
    t,
    hrZonesData,
    prs,
    workoutsByDay,
    monthDays,
    selectedDayWorkouts,
    monthDistance,
    monthCalories,
    monthActiveDays,
    monthAvgHr,
    longestStreak,
    calendarWeekdays,
    currentWeekStart,
    currentWeekEnd,
    currentWeekSummary,
    previousWeekSummary,
    weeklyDistanceChange,
    currentWeekMetLoad,
    previousWeekMetLoad,
    metLoadStatus,
    weeklyLoadStatus,
    weeklyRecoveryStatus,
    currentMonthWorkoutsCount,
    monthlyDistanceGoal,
    monthlyWorkoutGoal,
    avgHrGoal,
    monthlyDistanceProgress,
    monthlyWorkoutProgress,
    avgHrProgress,
    paceGoalProgress,
    bestWorkoutAllTime,
    currentBestPaceMinutes,
    recentAvgDistance,
    recentAvgHr,
    recentPaceSpread,
    fitnessIndex,
    healthFlags,
    currentIntensityScore,
    avgIntensityScore,
    peakIntensityWorkout,
    currentEfficiency,
    bestEfficiencyWorkout,
    currentWarmup,
    currentZoneProfile,
    weatherImpact,
    indoorWorkouts,
    outdoorWorkouts,
    dominantLocation,
    uniqueSources,
    uniqueDevices,
    workoutAiReview,
    weeklyCoach,
    explainedFlags,
    nextResultPrediction,
    metricExplainers,
    versusSummary,
    getDayLoad,
    getWorkoutType,
    getSmartWorkoutLabels,
    activityHeatmap,
    advancedGoals,
    coachBrief,
    selectedDayGap,
  } = buildHomeMetrics({
    workout,
    history,
    lang,
    currentMonth,
    selectedDateKey,
    selectedWorkouts,
    preferences,
  });

  const {
    aiResponse,
    isAiLoading,
    aiPlan,
    planPhases,
    isPlanLoading,
    trainingGoal,
    setTrainingGoal,
    setAiPlan,
    setPlanPhases,
    fetchAIPlan,
    fetchAIAdvice,
  } = useAiCoach({
    lang,
    history,
    workout,
    currentIntensityScore,
    currentWeekMetLoad,
    weeklyLoadLabel: weeklyLoadStatus.label,
    weeklyRecoveryLabel: weeklyRecoveryStatus.label,
    healthFlags,
    currentEfficiency,
    currentWarmup,
    currentZoneProfile,
  });

  const stats = workout
    ? [
        { label: t.distance, value: `${workout.distance.toFixed(2)} km`, icon: <MapPin size={18} />, color: '#007aff' },
        { label: t.duration, value: formatTime(workout.duration), icon: <Timer size={18} />, color: '#ff2d55' },
        { label: t.avgHr, value: `${workout.avgHeartRate} bpm`, icon: <Heart size={18} />, color: '#ff9500' },
        { label: t.calories, value: `${workout.calories} kcal`, icon: <Flame size={18} />, color: '#34c759' },
      ]
    : [];

  const toggleWorkoutSelection = (item: WorkoutData) => {
    if (selectedWorkouts.find((selected) => selected.uuid === item.uuid)) {
      setSelectedWorkouts(selectedWorkouts.filter((selected) => selected.uuid !== item.uuid));
    } else if (selectedWorkouts.length < 2) {
      setSelectedWorkouts([...selectedWorkouts, item]);
    } else {
      setSelectedWorkouts([selectedWorkouts[1], item]);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      await importWorkoutFile(file);
      setActiveTab('dashboard');
    } catch (error) {
      console.error('Error parsing/saving file:', error);
    } finally {
      event.target.value = '';
    }
  };

  if (!isClient) return null;
  return (
    <div className="app-container">
      <input 
        type="file" 
        accept=".json" 
        style={{ display: 'none' }} 
        ref={fileInputRef}
        onChange={handleFileUpload}
      />

      {/* Sidebar */}
      <aside className="sidebar">
        <div>
          <NextImage
            src="/runform-logo.png"
            alt="RunForm"
            width={244}
            height={82}
            priority
            style={{
              width: '100%',
              maxWidth: '220px',
              height: 'auto',
              display: 'block',
              objectFit: 'contain'
            }}
          />
          <p className="secondary-text" style={{ fontSize: '0.8rem', opacity: 0.6, marginTop: '10px' }}>v{APP_VERSION}</p>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <SidebarItem icon={<Activity size={20} />} label={t.dashboard} active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
          <SidebarItem icon={<HistoryIcon size={20} />} label={t.history} active={activeTab === 'history'} onClick={() => setActiveTab('history')} />
          <SidebarItem icon={<CalendarDays size={20} />} label={t.calendar} active={activeTab === 'calendar'} onClick={() => setActiveTab('calendar')} />
          <SidebarItem icon={<BarChart3 size={20} />} label={t.weeklySummary} active={activeTab === 'weekly-summary'} onClick={() => setActiveTab('weekly-summary')} />
          <SidebarItem icon={<Gauge size={20} />} label={t.fitnessIndex} active={activeTab === 'fitness-index'} onClick={() => setActiveTab('fitness-index')} />
          <SidebarItem icon={<Zap size={20} />} label={t.insights} active={activeTab === 'insights'} onClick={() => setActiveTab('insights')} />
          <SidebarItem icon={<TrendingUp size={20} />} label={t.trends} active={activeTab === 'trends'} onClick={() => setActiveTab('trends')} />
          <SidebarItem icon={<Target size={20} />} label={t.goals} active={activeTab === 'goals'} onClick={() => setActiveTab('goals')} />
          <SidebarItem icon={<ShieldAlert size={20} />} label={t.healthFlags} active={activeTab === 'health-flags'} onClick={() => setActiveTab('health-flags')} />
          <SidebarItem icon={<FileText size={20} />} label={t.report} active={activeTab === 'report'} onClick={() => setActiveTab('report')} />
          <SidebarItem icon={<Sparkles size={20} />} label={t.aiCoach} active={activeTab === 'ai-coach'} onClick={() => setActiveTab('ai-coach')} />
          <SidebarItem icon={<Zap size={20} />} label={t.nextWorkout} active={activeTab === 'next-workout'} onClick={() => setActiveTab('next-workout')} />
        </nav>

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <SidebarItem 
            icon={<Languages size={20} />} 
            label={lang === 'ru' ? 'English' : 'Русский'} 
            onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')} 
          />
          <SidebarItem icon={<Upload size={20} />} label={t.importJson} onClick={() => fileInputRef.current?.click()} />
          <SidebarItem icon={<Settings size={20} />} label={t.settings} active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
        </div>
      </aside>

      {/* Main View */}
      <main className="main-view animate-fade-in">
        {activeTab === 'dashboard' && (
          <>
            {!workout ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}>
                 <Upload size={48} style={{ marginBottom: '16px' }} />
                 <h2>Нет данных. Пожалуйста, импортируйте JSON файл тренировки.</h2>
              </div>
            ) : (
              <div
                ref={dashboardExportRef}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '40px',
                  background: 'radial-gradient(circle at top left, rgba(52, 199, 89, 0.12), transparent 25%), radial-gradient(circle at top right, rgba(0, 122, 255, 0.12), transparent 25%), #05070b',
                  padding: '8px',
                  borderRadius: '28px'
                }}
              >
                <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                  <div>
                    <h1 style={{ fontSize: '2.5rem', marginBottom: '4px' }}>{t.welcome}</h1>
                    <p className="secondary-text">
                        {t.analysisSubtitle
                            .replace('{name}', workout.name === 'Running' && lang === 'ru' ? 'по бегу' : workout.name)
                            .replace('{date}', new Date(workout.startDate).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'long' }))
                        }
                    </p>
                    
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '16px' }}>
                       <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', padding: '4px 12px' }}>
                          <Footprints size={14} className="secondary-text" style={{ marginRight: '6px' }} />
                          <select 
                            value={workout.shoeId || ''} 
                            onChange={(e) => assignShoe(workout.uuid, e.target.value || null)}
                            style={{ background: 'transparent', color: '#fff', border: 'none', outline: 'none', fontSize: '0.85rem' }}
                          >
                            <option value="" style={{ color: '#000' }}>{lang === 'ru' ? 'Нет кроссовок' : 'No shoe selected'}</option>
                            {shoes.map(s => (
                               <option key={s.id} value={s.id} style={{ color: '#000' }}>{s.name}</option>
                            ))}
                          </select>
                       </div>
                       
                       <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', padding: '4px 12px', gap: '6px' }}>
                          <Tag size={14} className="secondary-text" />
                          {(workout.tags || []).map((tag, idx) => (
                             <span key={idx} style={{ background: 'rgba(0,122,255,0.2)', color: '#007aff', fontSize: '0.75rem', padding: '2px 6px', borderRadius: '4px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                               {tag}
                               <X size={10} style={{ cursor: 'pointer' }} onClick={() => updateTags(workout.uuid, (workout.tags || []).filter(t => t !== tag))} />
                             </span>
                          ))}
                          <input 
                            placeholder={lang === 'ru' ? '+ Добавить тег' : '+ Add tag'}
                            onKeyDown={(e) => {
                               if (e.key === 'Enter' && e.currentTarget.value) {
                                   const newTags = [...(workout.tags || []), e.currentTarget.value];
                                   updateTags(workout.uuid, newTags);
                                   e.currentTarget.value = '';
                               }
                            }}
                            style={{ background: 'transparent', color: '#fff', border: 'none', outline: 'none', fontSize: '0.85rem', width: '100px' }}
                          />
                       </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }} className="no-print">
                     <button onClick={() => setShowShareCard(true)} style={{ background: 'rgba(52, 199, 89, 0.1)', color: '#34c759', border: '1px solid rgba(52, 199, 89, 0.2)', padding: '10px 16px', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 600 }}>
                        <Share2 size={18} /> {lang === 'ru' ? 'Поделиться' : 'Share'}
                     </button>
                     <button onClick={handleExport} style={{ background: 'rgba(0, 122, 255, 0.1)', color: '#007aff', border: '1px solid rgba(0, 122, 255, 0.2)', padding: '10px 16px', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 600 }}>
                        <Download size={18} /> {t.export}
                     </button>
                    <div className="premium-card" style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <Wind size={16} className="secondary-text" />
                        <span style={{ fontSize: '0.9rem' }}>
                            {workout.weather.temperature} · {workout.weather.humidity} {t.humidity}
                        </span>
                    </div>
                  </div>
                </header>

                <section style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px' }}>
                  {stats.map((s, i) => (
                    <div key={i} className="premium-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div style={{ padding: '8px', borderRadius: '10px', background: `${s.color}20`, color: s.color, width: 'fit-content' }}>
                        {s.icon}
                      </div>
                      <div>
                        <p className="secondary-text">{s.label}</p>
                        <h3 style={{ fontSize: '1.4rem' }}>{s.value}</h3>
                      </div>
                    </div>
                  ))}
                </section>

                <section style={{ display: 'grid', gridTemplateColumns: '1.4fr 1.6fr', gap: '20px', minHeight: '400px' }}>
                  {/* Unified HR Distribution Card */}
                  <div className="premium-card" style={{ display: 'flex', flexDirection: 'column' }}>
                    <h3 style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Activity size={18} className="accent-text" /> {lang === 'ru' ? 'Распределение пульса' : 'Heart Rate Distribution'}
                    </h3>
                    <div style={{ display: 'flex', gap: '24px', flexGrow: 1, alignItems: 'center' }}>
                      <div style={{ width: '160px', height: '160px', flexShrink: 0 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={hrZonesData}
                              innerRadius={52}
                              outerRadius={72}
                              paddingAngle={4}
                              dataKey="value"
                              stroke="none"
                            >
                              {hrZonesData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                              ))}
                            </Pie>
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {hrZonesData.map((zone, idx) => (
                          <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: zone.color }}></div>
                              <span style={{ fontSize: '0.88rem', color: '#cad3df' }}>{zone.name}</span>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: '0.88rem', fontWeight: 700 }}>{zone.percentage}%</div>
                              <div className="secondary-text" style={{ fontSize: '0.72rem' }}>{zone.formatted}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    <div style={{ width: '100%', height: '140px', marginTop: '24px' }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={hrZonesData} layout="vertical" margin={{ left: -20 }}>
                          <XAxis type="number" hide />
                          <YAxis dataKey="name" type="category" hide />
                          <Tooltip 
                            cursor={{fill: 'transparent'}}
                            contentStyle={{ background: '#121212', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} 
                          />
                          <Bar dataKey="minutes" radius={[0, 4, 4, 0]} barSize={14}>
                            {hrZonesData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Running Form & Efficiency Analysis Card */}
                  <div className="premium-card" style={{ display: 'flex', flexDirection: 'column' }}>
                    <h3 style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Gauge size={18} style={{ color: '#34c759' }} /> {lang === 'ru' ? 'Техника и эффективность' : 'Form & Efficiency'}
                    </h3>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', flexGrow: 1 }}>
                      <div style={{ padding: '16px', borderRadius: '16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <p className="secondary-text" style={{ fontSize: '0.78rem', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Footprints size={12} /> {lang === 'ru' ? 'Длина шага' : 'Stride Length'}
                        </p>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                          <h3 style={{ color: '#007aff', fontSize: '1.6rem' }}>{currentEfficiency?.strideLength || 0}</h3>
                          <span className="secondary-text" style={{ fontSize: '0.85rem' }}>cm</span>
                        </div>
                      </div>
                      
                      <div style={{ padding: '16px', borderRadius: '16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <p className="secondary-text" style={{ fontSize: '0.78rem', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Activity size={12} /> {lang === 'ru' ? 'Каденс' : 'Cadence'}
                        </p>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                          <h3 style={{ color: '#ff2d55', fontSize: '1.6rem' }}>{workout.cadence}</h3>
                          <span className="secondary-text" style={{ fontSize: '0.85rem' }}>spm</span>
                        </div>
                      </div>
                      
                      <div style={{ padding: '16px', borderRadius: '16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <p className="secondary-text" style={{ fontSize: '0.78rem', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Zap size={12} /> {lang === 'ru' ? 'Метров за удар' : 'Meters/Beat'}
                        </p>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                          <h3 style={{ color: '#ff9500', fontSize: '1.6rem' }}>{currentEfficiency?.metersPerBeat.toFixed(2) || 0}</h3>
                          <span className="secondary-text" style={{ fontSize: '0.85rem' }}>m</span>
                        </div>
                      </div>
                      
                      <div style={{ padding: '16px', borderRadius: '16px', background: 'rgba(52,199,89,0.08)', border: '1px solid rgba(52,199,89,0.12)' }}>
                        <p className="secondary-text" style={{ fontSize: '0.78rem', marginBottom: '8px', color: '#34c759' }}>
                           {lang === 'ru' ? 'Эффективность' : 'Efficiency'}
                        </p>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                          <h3 style={{ color: '#34c759', fontSize: '1.8rem' }}>{currentEfficiency?.score || 0}</h3>
                          <span className="secondary-text" style={{ fontSize: '0.8rem', color: '#34c759' }}>pts</span>
                        </div>
                      </div>
                    </div>
                    
                    <div style={{ marginTop: '24px', padding: '18px', borderRadius: '18px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                      <h4 style={{ fontSize: '0.88rem', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Sparkles size={14} style={{ color: '#ffd60a' }} /> {lang === 'ru' ? 'Сравнение с лучшим результатом' : 'vs. All-time Best efficiency'}
                      </h4>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '4px' }}>
                          <span className="secondary-text">{lang === 'ru' ? 'Эффективность бега' : 'Running efficiency score'}</span>
                          <span style={{ fontWeight: 700, color: (currentEfficiency?.score || 0) >= (bestEfficiencyWorkout ? getEfficiencyMetrics(bestEfficiencyWorkout).score : 0) ? '#34c759' : '#fff' }}>
                            {currentEfficiency?.score || 0} / {bestEfficiencyWorkout ? getEfficiencyMetrics(bestEfficiencyWorkout).score : 0}
                          </span>
                        </div>
                        <div style={{ height: '8px', borderRadius: '99px', background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
                          <div style={{ 
                            width: `${Math.min(100, ((currentEfficiency?.score || 0) / (bestEfficiencyWorkout ? getEfficiencyMetrics(bestEfficiencyWorkout).score || 1 : 1)) * 100)}%`, 
                            height: '100%', 
                            background: 'linear-gradient(90deg, #34c759 0%, #30d158 100%)',
                            borderRadius: '99px'
                          }} />
                        </div>
                        <p style={{ fontSize: '0.72rem', color: '#8b9ab1', marginTop: '4px' }}>
                          {lang === 'ru' 
                            ? 'Показывает, насколько технично прошла эта сессия относительно вашего пика.'
                            : 'Indicates how technical this session was compared to your absolute peak.'}
                        </p>
                      </div>
                    </div>
                  </div>
                </section>

                <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
                   <DetailRow label={t.avgCadence} value={`${workout.cadence} spm`} />
                   <DetailRow label={t.totalSteps} value={`${workout.steps.toLocaleString()}`} />
                   <DetailRow label={t.pace} value={`${workout.pace}/km`} />
                </section>

                {prs && (
                    <section>
                        <h3 style={{ marginBottom: '20px' }}>{lang === 'ru' ? 'Личные рекорды' : 'Personal Records'}</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px' }}>
                            <div className="premium-card">
                                <p className="secondary-text">{t.distance}</p>
                                <h4 style={{ color: '#34c759' }}>{prs.distance.toFixed(2)} km</h4>
                            </div>
                            <div className="premium-card">
                                <p className="secondary-text">{t.duration}</p>
                                <h4 style={{ color: '#ff2d55' }}>{formatTime(prs.duration)}</h4>
                            </div>
                            <div className="premium-card">
                                <p className="secondary-text">{t.pace}</p>
                                <h4 style={{ color: '#007aff' }}>{prs.pace.pace}/km</h4>
                            </div>
                            <div className="premium-card">
                                <p className="secondary-text">{t.calories}</p>
                                <h4 style={{ color: '#ff9500' }}>{prs.calories} kcal</h4>
                            </div>
                        </div>
                    </section>
                )}
              </div>
            )}
          </>
        )}

        {activeTab === 'history' && (
          <div className="history-view">
             <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
                <h1>{t.history}</h1>
                <button 
                  onClick={() => { setSelectionMode(!selectionMode); setSelectedWorkouts([]); }}
                  style={{ background: selectionMode ? 'rgba(0, 122, 255, 0.2)' : 'rgba(255, 255, 255, 0.05)', color: selectionMode ? '#007aff' : '#a0a0a0', border: '1px solid rgba(255, 255, 255, 0.1)', padding: '8px 16px', borderRadius: '12px', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600 }}
                >
                  {selectionMode ? t.versusMode : t.compare}
                </button>
             </div>

             {selectionMode && selectedWorkouts.length === 2 && (
                <button 
                    onClick={() => setActiveTab('versus')}
                    className="premium-card animate-fade-in"
                    style={{ width: '100%', background: '#007aff', color: '#fff', textAlign: 'center', fontWeight: 600, marginBottom: '20px', cursor: 'pointer', padding: '16px' }}
                >
                    {t.compare} ({selectedWorkouts.length}/2) <ArrowRight size={18} style={{ verticalAlign: 'middle', marginLeft: '8px' }} />
                </button>
             )}

             <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <input 
                  placeholder={lang === 'ru' ? 'Поиск по тегу или названию...' : 'Filter by tag or name...'}
                  value={tagFilter}
                  onChange={(e) => setTagFilter(e.target.value)}
                  style={{ padding: '12px 16px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: '0.95rem', outline: 'none', marginBottom: '8px' }}
                />
                {history.filter(w => {
                   if (!tagFilter) return true;
                   const search = tagFilter.toLowerCase();
                   return w.name.toLowerCase().includes(search) || (w.tags || []).some(t => t.toLowerCase().includes(search));
                }).map((w) => {
                   const isSelected = selectedWorkouts.find(sw => sw.uuid === w.uuid);
                   return (
                    <div 
                        key={w.uuid} 
                        className={`premium-card ${isSelected ? 'selected-card' : ''}`} 
                        style={{ display: 'flex', alignItems: 'center', gap: '24px', cursor: 'pointer', border: isSelected ? '1px solid #007aff' : '1px solid rgba(255, 255, 255, 0.05)' }} 
                        onClick={() => {
                            if (selectionMode) {
                                toggleWorkoutSelection(w);
                            } else {
                                setWorkout(w);
                                setActiveTab('dashboard');
                            }
                        }}
                    >
                        <div style={{ padding: '12px', borderRadius: '12px', background: isSelected ? 'rgba(0, 122, 255, 0.1)' : 'rgba(52, 199, 89, 0.1)', color: isSelected ? '#007aff' : '#34c759' }}>
                           {isSelected ? <CheckCircle2 size={24} /> : <Activity size={24} />}
                        </div>
                        <div style={{ flex: 1 }}>
                           <h3 style={{ fontSize: '1.1rem' }}>{w.name}</h3>
                           <p className="secondary-text">{new Date(w.startDate).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                           <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
                             {getSmartWorkoutLabels(w).map((tag) => (
                               <span key={`${w.uuid}-${tag.label}`} style={{ padding: '5px 9px', borderRadius: '999px', background: tag.bg, color: tag.color, fontSize: '0.72rem', fontWeight: 700 }}>
                                 {tag.label}
                               </span>
                             ))}
                             {(w.tags || []).map((tag, idx) => (
                               <span key={`custom-${w.uuid}-${idx}`} style={{ padding: '5px 9px', borderRadius: '4px', background: 'rgba(0,122,255,0.2)', color: '#007aff', fontSize: '0.72rem', fontWeight: 600 }}>
                                 <Tag size={10} style={{ marginRight: '4px' }} />
                                 {tag}
                               </span>
                             ))}
                           </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                           <h3 style={{ fontSize: '1.1rem' }}>{w.distance.toFixed(2)} km</h3>
                           <p className="secondary-text">{formatTime(w.duration)}</p>
                        </div>
                    </div>
                   );
                })}
                {history.length === 0 && (
                   <div style={{ padding: '40px', textAlign: 'center', opacity: 0.5 }}>
                      <AlertCircle size={40} style={{ marginBottom: '12px' }} />
                      <p>{lang === 'ru' ? 'История пока пуста.' : 'History is empty.'}</p>
                   </div>
                )}
             </div>
          </div>
        )}

        {activeTab === 'versus' && selectedWorkouts.length === 2 && (
            <div className="versus-view animate-fade-in">
                <header style={{ marginBottom: '32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h1>{t.versus}</h1>
                    <button onClick={() => setActiveTab('history')} className="secondary-text hover-light" style={{ cursor: 'pointer', background: 'rgba(255, 255, 255, 0.05)', border: 'none', padding: '8px 16px', borderRadius: '10px' }}>
                        {lang === 'ru' ? 'Назад в Историю' : 'Back to History'}
                    </button>
                </header>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px', background: 'rgba(255, 255, 255, 0.1)', borderRadius: '24px', overflow: 'hidden', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
                    {selectedWorkouts.map((w, idx) => (
                        <div key={w.uuid} style={{ background: '#0a0a0a', padding: '32px' }}>
                            <p className="secondary-text" style={{ marginBottom: '8px' }}>{new Date(w.startDate).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'long' })}</p>
                            <h2 style={{ marginBottom: '40px' }}>{w.name}</h2>
                            
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '24px' }}>
                                <ComparisonRow label={t.distance} value={`${w.distance.toFixed(2)} km`} isHigher={w.distance > selectedWorkouts[idx === 0 ? 1 : 0].distance} />
                                <ComparisonRow label={t.duration} value={formatTime(w.duration)} isHigher={w.duration > selectedWorkouts[idx === 0 ? 1 : 0].duration} />
                                <ComparisonRow label={t.avgHr} value={`${w.avgHeartRate} bpm`} isHigher={w.avgHeartRate > selectedWorkouts[idx === 0 ? 1 : 0].avgHeartRate} isGood={false} />
                                <ComparisonRow label={t.pace} value={`${w.pace}/km`} isHigher={parseFloat(w.pace.replace('′', '.')) < parseFloat(selectedWorkouts[idx === 0 ? 1 : 0].pace.replace('′', '.'))} />
                                <ComparisonRow label={t.calories} value={`${w.calories} kcal`} isHigher={w.calories > selectedWorkouts[idx === 0 ? 1 : 0].calories} />
                            </div>
                        </div>
                    ))}
                </div>

                <VersusSummaryCard lang={lang} selectedWorkouts={selectedWorkouts} summary={versusSummary} />
            </div>
        )}

        {activeTab === 'calendar' && (
          <div className="animate-fade-in" style={{ display: 'grid', gridTemplateColumns: '1.6fr 0.9fr', gap: '24px', alignItems: 'start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <div>
                  <h1 style={{ marginBottom: '8px' }}>{t.calendar}</h1>
                  <p className="secondary-text">
                    {lang === 'ru'
                      ? 'Сетка по дням с нагрузкой, пустыми днями и быстрым переходом к деталям.'
                      : 'Day grid with load, rest days, and quick access to details.'}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))}
                    style={{ width: '42px', height: '42px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: '#fff', cursor: 'pointer' }}
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))}
                    style={{ width: '42px', height: '42px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: '#fff', cursor: 'pointer' }}
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>

              <div className="premium-card" style={{ padding: '28px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                  <div>
                    <h2 style={{ fontSize: '1.5rem', marginBottom: '6px' }}>
                      {currentMonth.toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { month: 'long', year: 'numeric' })}
                    </h2>
                    <p className="secondary-text">
                      {lang === 'ru'
                        ? `${monthActiveDays} активных дней в этом месяце`
                        : `${monthActiveDays} active days this month`}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <span style={{ padding: '8px 12px', borderRadius: '999px', background: 'rgba(52,199,89,0.14)', color: '#34c759', fontSize: '0.82rem', fontWeight: 700 }}>
                      {lang === 'ru' ? `Серия: ${longestStreak} дн.` : `Streak: ${longestStreak}d`}
                    </span>
                    <span style={{ padding: '8px 12px', borderRadius: '999px', background: 'rgba(0,122,255,0.14)', color: '#57a6ff', fontSize: '0.82rem', fontWeight: 700 }}>
                      {lang === 'ru' ? `${monthDistance.toFixed(1)} км` : `${monthDistance.toFixed(1)} km`}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '10px', marginBottom: '10px' }}>
                  {calendarWeekdays.map((weekday) => (
                    <div key={weekday} style={{ padding: '8px 10px', fontSize: '0.8rem', color: '#7f8a9a', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
                      {weekday}
                    </div>
                  ))}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '10px' }}>
                  {monthDays.map(({ date, key, inMonth }) => {
                    const dayWorkouts = workoutsByDay[key] || [];
                    const totalDistance = dayWorkouts.reduce((sum, item) => sum + item.distance, 0);
                    const avgHrForDay = dayWorkouts.length > 0
                      ? Math.round(dayWorkouts.reduce((sum, item) => sum + item.avgHeartRate, 0) / dayWorkouts.length)
                      : 0;
                    const longestWorkout = dayWorkouts.reduce<WorkoutData | null>((best, item) => {
                      if (!best || item.distance > best.distance) return item;
                      return best;
                    }, null);
                    const load = getDayLoad(totalDistance, avgHrForDay);
                    const workoutType = longestWorkout ? getWorkoutType(longestWorkout) : null;
                    const isSelected = selectedDateKey === key;
                    const isToday = getDateKey(new Date()) === key;

                    return (
                      <button
                        key={key}
                        onClick={() => setSelectedDateKey(key)}
                        style={{
                          minHeight: '108px',
                          borderRadius: '18px',
                          border: isSelected ? '1px solid rgba(87,166,255,0.85)' : '1px solid rgba(255,255,255,0.06)',
                          background: dayWorkouts.length > 0
                            ? 'linear-gradient(180deg, rgba(14, 25, 41, 0.95) 0%, rgba(7, 12, 21, 0.95) 100%)'
                            : 'rgba(255,255,255,0.025)',
                          padding: '12px',
                          textAlign: 'left',
                          cursor: 'pointer',
                          opacity: inMonth ? 1 : 0.35,
                          boxShadow: isSelected ? '0 0 0 1px rgba(87,166,255,0.2), 0 10px 24px rgba(0,0,0,0.35)' : 'none',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                          <span style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fff' }}>{date.getDate()}</span>
                          {isToday && (
                            <span style={{ fontSize: '0.68rem', fontWeight: 800, color: '#05070b', background: '#34c759', borderRadius: '999px', padding: '3px 7px' }}>
                              {lang === 'ru' ? 'Сегодня' : 'Today'}
                            </span>
                          )}
                        </div>
                        {dayWorkouts.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ width: '100%', height: '6px', borderRadius: '999px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                              <div style={{ width: load.width, height: '100%', borderRadius: '999px', background: load.fill }} />
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: load.color }} />
                              <span style={{ fontSize: '0.82rem', color: '#d8e1ee', fontWeight: 700 }}>
                                {totalDistance.toFixed(1)} {lang === 'ru' ? 'км' : 'km'}
                              </span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
                              <p style={{ fontSize: '0.74rem', color: '#8b9ab1' }}>
                                {dayWorkouts.length} {lang === 'ru' ? 'трен.' : 'workouts'}
                              </p>
                              {workoutType && (
                                <span style={{ fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.05em', color: workoutType.color }}>
                                  {workoutType.short}
                                </span>
                              )}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                              <p style={{ fontSize: '0.74rem', color: '#8b9ab1' }}>
                                HR {avgHrForDay} bpm
                              </p>
                              <p style={{ fontSize: '0.7rem', color: load.color, fontWeight: 700 }}>
                                {load.label}
                              </p>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', color: '#576171' }}>
                            <div style={{ width: '100%', height: '6px', borderRadius: '999px', background: 'rgba(255,255,255,0.05)' }} />
                            <p style={{ fontSize: '0.72rem' }}>
                              {lang === 'ru' ? 'Восстановление' : 'Recovery'}
                            </p>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div className="premium-card">
                <h3 style={{ marginBottom: '18px' }}>
                  {selectedDateKey
                    ? new Date(`${selectedDateKey}T00:00:00`).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' })
                    : (lang === 'ru' ? 'Выберите день' : 'Select a day')}
                </h3>

                {selectedDayWorkouts.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {selectedDayGap !== null && (
                      <div style={{ borderRadius: '14px', padding: '14px 16px', background: 'rgba(255,149,0,0.08)', border: '1px solid rgba(255,149,0,0.12)' }}>
                        <p className="secondary-text" style={{ marginBottom: '4px' }}>
                          {lang === 'ru' ? 'Разрыв с прошлой беговой датой' : 'Gap since previous run day'}
                        </p>
                        <h4 style={{ color: '#ff9500' }}>
                          {selectedDayGap === 0
                            ? (lang === 'ru' ? 'без пропуска' : 'no break')
                            : (lang === 'ru' ? `${selectedDayGap} дн. без бега` : `${selectedDayGap} days off`)}
                        </h4>
                      </div>
                    )}
                    {selectedDayWorkouts.map((item) => {
                      const workoutType = getWorkoutType(item);
                      const load = getDayLoad(item.distance, item.avgHeartRate);
                      return (
                      <button
                        key={item.uuid}
                        className="premium-card"
                        onClick={() => {
                          setWorkout(item);
                          setActiveTab('dashboard');
                        }}
                        style={{ textAlign: 'left', padding: '18px', borderColor: 'rgba(52,199,89,0.14)', background: 'rgba(52,199,89,0.05)', cursor: 'pointer' }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', marginBottom: '8px' }}>
                          <h4>{item.name}</h4>
                          <span style={{ color: '#34c759', fontWeight: 700 }}>{item.distance.toFixed(2)} {lang === 'ru' ? 'км' : 'km'}</span>
                        </div>
                        <p className="secondary-text" style={{ marginBottom: '8px' }}>
                          {new Date(item.startDate).toLocaleTimeString(lang === 'ru' ? 'ru-RU' : 'en-US', { hour: '2-digit', minute: '2-digit' })} · {formatTime(item.duration)}
                        </p>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.84rem', color: '#cad3df', marginBottom: '10px' }}>
                          <span>HR {item.avgHeartRate} bpm</span>
                          <span>{item.pace}/km</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.05em', color: workoutType.color }}>
                            {workoutType.label}
                          </span>
                          <span style={{ fontSize: '0.76rem', fontWeight: 700, color: load.color }}>
                            {lang === 'ru' ? `Нагрузка: ${load.label}` : `Load: ${load.label}`}
                          </span>
                        </div>
                      </button>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ borderRadius: '16px', border: '1px dashed rgba(255,255,255,0.1)', padding: '24px', color: '#8992a0' }}>
                    {lang === 'ru'
                      ? 'На выбранный день тренировок нет. Это видно и в сетке как пустой день восстановления.'
                      : 'No workouts on the selected day. It is shown in the grid as a recovery day.'}
                  </div>
                )}
              </div>

              <div className="premium-card" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div style={{ padding: '14px', borderRadius: '16px', background: 'rgba(0,122,255,0.08)' }}>
                  <p className="secondary-text" style={{ marginBottom: '6px' }}>{lang === 'ru' ? 'Объём месяца' : 'Month volume'}</p>
                  <h3>{monthDistance.toFixed(1)} {lang === 'ru' ? 'км' : 'km'}</h3>
                </div>
                <div style={{ padding: '14px', borderRadius: '16px', background: 'rgba(255,149,0,0.08)' }}>
                  <p className="secondary-text" style={{ marginBottom: '6px' }}>{lang === 'ru' ? 'Средний пульс' : 'Average HR'}</p>
                  <h3>{monthAvgHr || '—'} {monthAvgHr ? 'bpm' : ''}</h3>
                </div>
                <div style={{ padding: '14px', borderRadius: '16px', background: 'rgba(52,199,89,0.08)' }}>
                  <p className="secondary-text" style={{ marginBottom: '6px' }}>{lang === 'ru' ? 'Активные дни' : 'Active days'}</p>
                  <h3>{monthActiveDays}</h3>
                </div>
                <div style={{ padding: '14px', borderRadius: '16px', background: 'rgba(255,45,85,0.08)' }}>
                  <p className="secondary-text" style={{ marginBottom: '6px' }}>{lang === 'ru' ? 'Калории' : 'Calories'}</p>
                  <h3>{monthCalories.toLocaleString()}</h3>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'weekly-summary' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div>
              <h1 style={{ marginBottom: '8px' }}>{t.weeklySummary}</h1>
              <p className="secondary-text">
                {lang === 'ru'
                  ? `Неделя ${currentWeekStart.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} - ${currentWeekEnd.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`
                  : `Week ${currentWeekStart.toLocaleDateString('en-US', { day: 'numeric', month: 'long' })} - ${currentWeekEnd.toLocaleDateString('en-US', { day: 'numeric', month: 'long' })}`}
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px' }}>
              <div className="premium-card">
                <p className="secondary-text">{lang === 'ru' ? 'Общий объём' : 'Total volume'}</p>
                <h3 style={{ marginTop: '8px' }}>{currentWeekSummary.distance.toFixed(1)} {lang === 'ru' ? 'км' : 'km'}</h3>
              </div>
              <div className="premium-card">
                <p className="secondary-text">{lang === 'ru' ? 'Активные дни' : 'Active days'}</p>
                <h3 style={{ marginTop: '8px' }}>{currentWeekSummary.activeDays}</h3>
              </div>
              <div className="premium-card">
                <p className="secondary-text">{lang === 'ru' ? 'Средний пульс' : 'Average HR'}</p>
                <h3 style={{ marginTop: '8px' }}>{currentWeekSummary.avgHr || '—'} {currentWeekSummary.avgHr ? 'bpm' : ''}</h3>
              </div>
              <div className="premium-card">
                <p className="secondary-text">{lang === 'ru' ? 'Лучший темп' : 'Best pace'}</p>
                <h3 style={{ marginTop: '8px' }}>{currentWeekSummary.bestPaceWorkout ? `${currentWeekSummary.bestPaceWorkout.pace}/km` : '—'}</h3>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
              <div className="premium-card">
                <MetricLabel
                  label={lang === 'ru' ? 'MET-load за неделю' : 'Weekly MET load'}
                  hint={lang === 'ru'
                    ? 'MET-load показывает суммарную энергетическую нагрузку за неделю: METs умножаются на длительность тренировки.'
                    : 'Weekly MET load estimates total energy load by multiplying METs by workout duration.'}
                />
                <h3 style={{ marginTop: '8px' }}>{currentWeekMetLoad}</h3>
              </div>
              <div className="premium-card">
                <MetricLabel
                  label={lang === 'ru' ? 'Прошлая неделя' : 'Previous week'}
                  hint={lang === 'ru'
                    ? 'То же значение MET-load, но для предыдущей недели, чтобы видеть динамику.'
                    : 'The same MET-load metric for the previous week to compare trend.'}
                />
                <h3 style={{ marginTop: '8px' }}>{previousWeekMetLoad}</h3>
              </div>
              <div className="premium-card">
                <MetricLabel
                  label={lang === 'ru' ? 'Статус MET-load' : 'MET-load status'}
                  hint={lang === 'ru'
                    ? 'Упрощённая интерпретация недельной энергозатратности: лёгкая, рабочая или высокая нагрузка.'
                    : 'A simplified interpretation of weekly energy cost: light, productive, or high load.'}
                />
                <h3 style={{ marginTop: '8px', color: metLoadStatus.color }}>{metLoadStatus.label}</h3>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '20px' }}>
              <div className="premium-card" style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                <div>
                  <p className="secondary-text" style={{ marginBottom: '6px' }}>{lang === 'ru' ? 'Изменение относительно прошлой недели' : 'Change vs previous week'}</p>
                  <h2 style={{ color: weeklyDistanceChange >= 0 ? '#34c759' : '#ff9500' }}>
                    {previousWeekSummary.distance > 0 ? `${weeklyDistanceChange >= 0 ? '+' : ''}${weeklyDistanceChange.toFixed(0)}%` : '—'}
                  </h2>
                </div>
                <div style={{ padding: '16px', borderRadius: '16px', background: 'rgba(255,255,255,0.03)' }}>
                  <p className="secondary-text" style={{ marginBottom: '6px' }}>{lang === 'ru' ? 'Нагрузка' : 'Load'}</p>
                  <h3 style={{ color: weeklyLoadStatus.color, marginBottom: '8px' }}>{weeklyLoadStatus.label}</h3>
                  <p style={{ color: '#c9d1da', lineHeight: 1.5 }}>{weeklyLoadStatus.detail}</p>
                </div>
                <div style={{ padding: '16px', borderRadius: '16px', background: 'rgba(255,255,255,0.03)' }}>
                  <MetricLabel
                    label={lang === 'ru' ? 'Тренд восстановления' : 'Recovery trend'}
                    hint={lang === 'ru'
                      ? 'Показывает, становится ли средний пульс на тренировках легче или тяжелее относительно прошлой недели.'
                      : 'Shows whether average training heart rate is trending easier or harder versus the previous week.'}
                  />
                  <h3 style={{ color: weeklyRecoveryStatus.color }}>{weeklyRecoveryStatus.label}</h3>
                </div>
              </div>

              <div className="premium-card" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <h3>{lang === 'ru' ? 'Разбивка по дням' : 'Day by day'}</h3>
                {Array.from({ length: 7 }, (_, index) => {
                  const day = new Date(currentWeekStart);
                  day.setDate(currentWeekStart.getDate() + index);
                  const key = getDateKey(day);
                  const dayEntries = workoutsByDay[key] || [];
                  const distance = dayEntries.reduce((sum, item) => sum + item.distance, 0);
                  const load = getDayLoad(distance, dayEntries.length > 0 ? Math.round(dayEntries.reduce((sum, item) => sum + item.avgHeartRate, 0) / dayEntries.length) : 0);
                  return (
                    <div key={key} style={{ display: 'grid', gridTemplateColumns: '100px 1fr auto', gap: '14px', alignItems: 'center' }}>
                      <span className="secondary-text">
                        {day.toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { weekday: 'short', day: 'numeric' })}
                      </span>
                      <div style={{ height: '8px', borderRadius: '999px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                        <div style={{ width: dayEntries.length > 0 ? `${Math.min(100, distance * 10)}%` : '0%', height: '100%', background: load.fill }} />
                      </div>
                      <span style={{ color: dayEntries.length > 0 ? load.color : '#6b7280', fontSize: '0.82rem', fontWeight: 700 }}>
                        {dayEntries.length > 0 ? `${distance.toFixed(1)} km` : 'rest'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'fitness-index' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div>
              <h1 style={{ marginBottom: '8px' }}>{t.fitnessIndex}</h1>
              <p className="secondary-text">
                {lang === 'ru'
                  ? 'Сводный индекс на основе объёма, частоты, пульса, темпа и стабильности последних тренировок.'
                  : 'Composite score based on volume, frequency, heart rate, pace, and stability of recent workouts.'}
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: '20px' }}>
              <div className="premium-card" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                  <div style={{ width: '140px', height: '140px', borderRadius: '50%', background: `conic-gradient(${fitnessIndex.color} ${fitnessIndex.value}%, rgba(255,255,255,0.06) 0)`, display: 'grid', placeItems: 'center' }}>
                    <div style={{ width: '104px', height: '104px', borderRadius: '50%', background: '#0a0f17', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontSize: '2rem', fontWeight: 800 }}>{fitnessIndex.value}</span>
                      <span className="secondary-text" style={{ fontSize: '0.8rem' }}>score</span>
                    </div>
                  </div>
                  <div>
                    <h2 style={{ color: fitnessIndex.color, marginBottom: '8px' }}>{fitnessIndex.label}</h2>
                    <p style={{ color: '#c9d1da', lineHeight: 1.6 }}>
                      {lang === 'ru'
                        ? 'Индекс помогает быстро оценить текущую форму без погружения во все графики.'
                        : 'This index gives a quick view of your current condition without opening every chart.'}
                    </p>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                  <div style={{ padding: '14px', borderRadius: '16px', background: 'rgba(0,122,255,0.08)' }}>
                    <MetricLabel
                      label={lang === 'ru' ? 'Средняя дистанция' : 'Average distance'}
                      hint={lang === 'ru'
                        ? 'Средняя дистанция последних тренировок, используемая как один из сигналов общей формы.'
                        : 'Average distance across recent workouts, used as one of the fitness signals.'}
                    />
                    <h3 style={{ marginTop: '6px' }}>{recentAvgDistance.toFixed(1)} {lang === 'ru' ? 'км' : 'km'}</h3>
                  </div>
                  <div style={{ padding: '14px', borderRadius: '16px', background: 'rgba(255,149,0,0.08)' }}>
                    <MetricLabel
                      label={lang === 'ru' ? 'Средний HR' : 'Average HR'}
                      hint={lang === 'ru'
                        ? 'Средний пульс по последним тренировкам. Ниже при похожем темпе обычно означает лучшую экономичность.'
                        : 'Average heart rate over recent workouts. Lower at similar pace usually means better efficiency.'}
                    />
                    <h3 style={{ marginTop: '6px' }}>{recentAvgHr ? Math.round(recentAvgHr) : '—'} {recentAvgHr ? 'bpm' : ''}</h3>
                  </div>
                  <div style={{ padding: '14px', borderRadius: '16px', background: 'rgba(52,199,89,0.08)' }}>
                    <MetricLabel
                      label={lang === 'ru' ? 'Лучший темп' : 'Best pace'}
                      hint={lang === 'ru'
                        ? 'Самый быстрый темп в истории: меньшее значение означает более быстрый бег.'
                        : 'Fastest pace in history: lower value means faster running.'}
                    />
                    <h3 style={{ marginTop: '6px' }}>{bestWorkoutAllTime ? `${bestWorkoutAllTime.pace}/km` : '—'}</h3>
                  </div>
                  <div style={{ padding: '14px', borderRadius: '16px', background: 'rgba(175,82,222,0.08)' }}>
                    <MetricLabel
                      label={lang === 'ru' ? 'Стабильность темпа' : 'Pace stability'}
                      hint={lang === 'ru'
                        ? 'Разброс темпа между последними тренировками. Чем меньше, тем стабильнее ритм.'
                        : 'Spread of pace across recent workouts. Lower means more stable pacing.'}
                    />
                    <h3 style={{ marginTop: '6px' }}>{recentPaceSpread.toFixed(2)} {lang === 'ru' ? 'мин/км' : 'min/km'}</h3>
                  </div>
                </div>
              </div>

              <div className="premium-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <h3>{lang === 'ru' ? 'Из чего состоит индекс' : 'What drives the score'}</h3>
                {[
                  { label: lang === 'ru' ? 'Частота тренировок' : 'Workout frequency', value: Math.min(100, currentWeekSummary.activeDays * 20), color: '#34c759' },
                  { label: lang === 'ru' ? 'Недельный объём' : 'Weekly volume', value: Math.min(100, Math.round((currentWeekSummary.distance / 25) * 100)), color: '#007aff' },
                  { label: lang === 'ru' ? 'Пульс под контролем' : 'Heart rate control', value: Math.max(0, Math.min(100, Math.round((140 - (monthAvgHr || recentAvgHr || 140)) * 4 + 50))), color: '#ff9500' },
                  { label: lang === 'ru' ? 'Темп' : 'Pace', value: currentBestPaceMinutes ? Math.max(0, Math.min(100, Math.round((10 / currentBestPaceMinutes) * 100))) : 0, color: '#ff2d55' },
                  { label: lang === 'ru' ? 'Стабильность' : 'Stability', value: Math.max(0, Math.min(100, Math.round(100 - recentPaceSpread * 18))), color: '#af52de' },
                ].map((metric) => (
                  <div key={metric.label}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <span>{metric.label}</span>
                      <span style={{ color: metric.color, fontWeight: 700 }}>{metric.value}%</span>
                    </div>
                    <div style={{ height: '8px', borderRadius: '999px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                      <div style={{ width: `${metric.value}%`, height: '100%', background: metric.color }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'insights' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div>
              <h1 style={{ marginBottom: '8px' }}>{t.insights}</h1>
              <p className="secondary-text">
                {lang === 'ru'
                  ? 'Расширенная аналитика из сырых полей JSON, которые раньше не использовались.'
                  : 'Extended analytics derived from raw JSON fields that were not used before.'}
              </p>
            </div>

            <div className="premium-card" style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr', gap: '20px' }}>
              <div>
                <MetricLabel
                  label={lang === 'ru' ? 'Intensity Score' : 'Intensity Score'}
                  hint={lang === 'ru'
                    ? 'Сводный балл тяжести тренировки по intensity, MET и времени в тяжёлых зонах.'
                    : 'Composite training hardness score based on intensity, METs, and time in harder zones.'}
                />
                <h2 style={{ fontSize: '2.4rem', marginBottom: '10px', color: currentIntensityScore >= 85 ? '#ff2d55' : currentIntensityScore >= 70 ? '#ff9500' : '#34c759' }}>
                  {currentIntensityScore || '—'}
                </h2>
                <p style={{ color: '#d2dae5', lineHeight: 1.6 }}>
                  {lang === 'ru'
                    ? 'Score собирается из средней интенсивности, пиков, MET и доли времени в тяжёлых зонах.'
                    : 'The score combines average intensity, peaks, METs, and time spent in harder zones.'}
                </p>
              </div>
              <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(255,255,255,0.03)' }}>
                <MetricLabel
                  label={lang === 'ru' ? 'Средний score по истории' : 'Average historical score'}
                  hint={lang === 'ru'
                    ? 'Среднее значение Intensity Score по всей истории тренировок.'
                    : 'Average Intensity Score across all recorded workouts.'}
                />
                <h3 style={{ marginTop: '8px' }}>{avgIntensityScore || '—'}</h3>
              </div>
              <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(255,255,255,0.03)' }}>
                <MetricLabel
                  label={lang === 'ru' ? 'Самая тяжёлая тренировка' : 'Hardest workout'}
                  hint={lang === 'ru'
                    ? 'Тренировка с максимальным Intensity Score в истории.'
                    : 'Workout with the highest Intensity Score in history.'}
                />
                <h3 style={{ marginTop: '8px' }}>{peakIntensityWorkout ? getIntensityScore(peakIntensityWorkout) : '—'}</h3>
                <p className="secondary-text" style={{ marginTop: '6px' }}>
                  {peakIntensityWorkout
                    ? new Date(peakIntensityWorkout.startDate).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US')
                    : ''}
                </p>
              </div>
            </div>

            <div className="premium-card" style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr 1fr', gap: '20px' }}>
              <div>
                <MetricLabel
                  label={lang === 'ru' ? 'Running Efficiency' : 'Running Efficiency'}
                  hint={lang === 'ru'
                    ? 'Оценка экономичности бега по сочетанию темпа, пульса, каденса и длины шага.'
                    : 'Estimate of running economy based on pace, heart rate, cadence, and stride length.'}
                />
                <h2 style={{ fontSize: '2.2rem', marginBottom: '10px', color: currentEfficiency && currentEfficiency.score >= 75 ? '#34c759' : '#ff9500' }}>
                  {currentEfficiency?.score ?? '—'}
                </h2>
                <p style={{ color: '#d2dae5', lineHeight: 1.6 }}>
                  {lang === 'ru'
                    ? 'Score учитывает каденс, длину шага, темп и пульс, чтобы оценить экономичность бега.'
                    : 'This score combines cadence, stride length, pace, and heart rate to assess running economy.'}
                </p>
              </div>
              <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(255,255,255,0.03)' }}>
                <MetricLabel
                  label={lang === 'ru' ? 'Длина шага' : 'Stride length'}
                  hint={lang === 'ru'
                    ? 'Средняя длина шага в сантиметрах: дистанция делится на количество шагов.'
                    : 'Average stride length in centimeters: distance divided by number of steps.'}
                />
                <h3 style={{ marginTop: '8px' }}>{currentEfficiency ? `${currentEfficiency.strideLength} cm` : '—'}</h3>
              </div>
              <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(255,255,255,0.03)' }}>
                <MetricLabel
                  label={lang === 'ru' ? 'Метров за удар' : 'Meters per beat'}
                  hint={lang === 'ru'
                    ? 'Дистанция в метрах, которую вы пробигаете за один удар сердца. Чем выше показатель, тем вы экономичнее.'
                    : 'The distance in meters you cover with each heartbeat. Higher values mean better efficiency.'}
                />
                <h3 style={{ marginTop: '8px' }}>{currentEfficiency ? currentEfficiency.metersPerBeat.toFixed(2) : '—'}</h3>
              </div>
              <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(255,255,255,0.03)' }}>
                <MetricLabel
                  label={lang === 'ru' ? 'Лучшая эффективная тренировка' : 'Best efficiency workout'}
                  hint={lang === 'ru'
                    ? 'Тренировка с максимальным Running Efficiency score.'
                    : 'Workout with the highest Running Efficiency score.'}
                />
                <h3 style={{ marginTop: '8px' }}>{bestEfficiencyWorkout ? getEfficiencyMetrics(bestEfficiencyWorkout).score : '—'}</h3>
                <p className="secondary-text" style={{ marginTop: '6px' }}>
                  {bestEfficiencyWorkout
                    ? new Date(bestEfficiencyWorkout.startDate).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US')
                    : ''}
                </p>
              </div>
            </div>

            <div className="premium-card" style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr', gap: '20px' }}>
              <div>
                <MetricLabel
                  label={lang === 'ru' ? 'Warmup / Cooldown Analysis' : 'Warmup / Cooldown Analysis'}
                  hint={lang === 'ru'
                    ? 'Проверяет качество входа в тренировку по времени в Z1, минимальному пульсу и распределению нагрузки.'
                    : 'Evaluates session entry quality using time in Z1, minimum HR, and load distribution.'}
                />
                <h2 style={{ fontSize: '2rem', marginBottom: '10px', color: currentWarmup && currentWarmup.controlScore >= 70 ? '#34c759' : '#ff9500' }}>
                  {currentWarmup?.controlScore ?? '—'}
                </h2>
                <p style={{ color: '#d2dae5', lineHeight: 1.6 }}>
                  {currentWarmup?.label ?? (lang === 'ru' ? 'Нет данных для анализа разминки.' : 'No warmup data available.')}
                </p>
              </div>
              <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(255,255,255,0.03)' }}>
                <MetricLabel
                  label={lang === 'ru' ? 'Время в Z1' : 'Time in Z1'}
                  hint={lang === 'ru'
                    ? 'Сколько времени тренировка провела в зоне разминки / очень лёгкой работы.'
                    : 'How much time the workout spent in the warmup / very easy zone.'}
                />
                <h3 style={{ marginTop: '8px' }}>{currentWarmup ? formatTime(currentWarmup.warmupSeconds) : '—'}</h3>
              </div>
              <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(255,255,255,0.03)' }}>
                <MetricLabel
                  label={lang === 'ru' ? 'Доля разминки' : 'Warmup share'}
                  hint={lang === 'ru'
                    ? 'Процент времени тренировки, проведённый в Z1.'
                    : 'Percentage of total workout time spent in Z1.'}
                />
                <h3 style={{ marginTop: '8px' }}>{currentWarmup ? `${Math.round(currentWarmup.warmupRate * 100)}%` : '—'}</h3>
              </div>
            </div>

            <div className="premium-card" style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: '20px' }}>
              <div>
                <MetricLabel
                  label={lang === 'ru' ? 'Zone Profile' : 'Zone Profile'}
                  hint={lang === 'ru'
                    ? 'Тип тренировки по распределению времени между пульсовыми зонами.'
                    : 'Workout type inferred from how time is distributed across heart-rate zones.'}
                />
                <h2 style={{ marginBottom: '10px', color: currentZoneProfile?.color ?? '#fff' }}>{currentZoneProfile?.label ?? '—'}</h2>
                <p style={{ color: '#d2dae5', lineHeight: 1.6 }}>
                  {currentZoneProfile?.detail ?? (lang === 'ru' ? 'Недостаточно данных по зонам.' : 'Not enough zone data.')}
                </p>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                {[
                  { label: 'Z1', value: Math.round((workout?.zones.zone1?.rate ?? 0) * 100), color: '#34c759' },
                  { label: 'Z2', value: Math.round((workout?.zones.zone2?.rate ?? 0) * 100), color: '#007aff' },
                  { label: 'Z3', value: Math.round((workout?.zones.zone3?.rate ?? 0) * 100), color: '#ff9500' },
                  { label: 'Z4', value: Math.round((workout?.zones.zone4?.rate ?? 0) * 100), color: '#ff2d55' },
                ].map((zone) => (
                  <div key={zone.label} style={{ padding: '16px', borderRadius: '16px', background: 'rgba(255,255,255,0.03)' }}>
                    <p className="secondary-text">{zone.label}</p>
                    <h3 style={{ marginTop: '8px', color: zone.color }}>{zone.value}%</h3>
                  </div>
                ))}
              </div>
            </div>

            <div className="premium-card" style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr 1fr', gap: '20px' }}>
              <div>
                <MetricLabel
                  label={lang === 'ru' ? 'Weather Impact' : 'Weather Impact'}
                  hint={lang === 'ru'
                    ? 'Оценка того, насколько температура и влажность могли усложнить тренировку.'
                    : 'Estimate of how much temperature and humidity may have affected the session.'}
                />
                <h2 style={{ marginBottom: '10px', color: weatherImpact && weatherImpact.stress >= 38 ? '#ff9500' : '#34c759' }}>
                  {weatherImpact?.label ?? '—'}
                </h2>
                <p style={{ color: '#d2dae5', lineHeight: 1.6 }}>
                  {lang === 'ru'
                    ? 'Температура и влажность учитываются как внешний стрессор для темпа и пульса.'
                    : 'Temperature and humidity are treated as an external stress factor for pace and HR.'}
                </p>
              </div>
              <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(255,255,255,0.03)' }}>
                <p className="secondary-text">{lang === 'ru' ? 'Температура' : 'Temperature'}</p>
                <h3 style={{ marginTop: '8px' }}>{workout?.weather.temperature ?? '—'}</h3>
              </div>
              <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(255,255,255,0.03)' }}>
                <p className="secondary-text">{lang === 'ru' ? 'Влажность' : 'Humidity'}</p>
                <h3 style={{ marginTop: '8px' }}>{workout?.weather.humidity ?? '—'}</h3>
              </div>
              <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(255,255,255,0.03)' }}>
                <MetricLabel
                  label={lang === 'ru' ? 'Погодный stress score' : 'Weather stress score'}
                  hint={lang === 'ru'
                    ? 'Условный балл внешней нагрузки от погоды. Чем выше, тем сильнее условия могли влиять на пульс и темп.'
                    : 'A rough external-load score from weather. Higher means conditions may have influenced HR and pace more.'}
                />
                <h3 style={{ marginTop: '8px' }}>{weatherImpact?.stress ?? '—'}</h3>
              </div>
            </div>

            <div className="premium-card" style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr', gap: '20px' }}>
              <div>
                <p className="secondary-text" style={{ marginBottom: '8px' }}>{lang === 'ru' ? 'Indoor / Outdoor Profiling' : 'Indoor / Outdoor Profiling'}</p>
                <h2 style={{ marginBottom: '10px' }}>{dominantLocation}</h2>
                <p style={{ color: '#d2dae5', lineHeight: 1.6 }}>
                  {lang === 'ru'
                    ? 'Профиль строится по полю location и помогает разделять условия выполнения тренировки.'
                    : 'The profile uses the location field to separate training environments.'}
                </p>
              </div>
              <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(255,255,255,0.03)' }}>
                <p className="secondary-text">Indoor</p>
                <h3 style={{ marginTop: '8px' }}>{indoorWorkouts.length}</h3>
              </div>
              <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(255,255,255,0.03)' }}>
                <p className="secondary-text">Outdoor</p>
                <h3 style={{ marginTop: '8px' }}>{outdoorWorkouts.length}</h3>
              </div>
            </div>

            <div className="premium-card" style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr', gap: '20px' }}>
              <div>
                <p className="secondary-text" style={{ marginBottom: '8px' }}>{lang === 'ru' ? 'Source / Device Audit' : 'Source / Device Audit'}</p>
                <h2 style={{ marginBottom: '10px' }}>{history[0]?.device.name ?? '—'}</h2>
                <p style={{ color: '#d2dae5', lineHeight: 1.6 }}>
                  {lang === 'ru'
                    ? 'Технический аудит источника данных помогает отслеживать происхождение и совместимость записей.'
                    : 'Technical source auditing helps track provenance and compatibility of records.'}
                </p>
              </div>
              <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(255,255,255,0.03)' }}>
                <p className="secondary-text">{lang === 'ru' ? 'Источники' : 'Sources'}</p>
                <h3 style={{ marginTop: '8px' }}>{uniqueSources.length}</h3>
                <p className="secondary-text" style={{ marginTop: '6px' }}>{uniqueSources[0] ?? '—'}</p>
              </div>
              <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(255,255,255,0.03)' }}>
                <p className="secondary-text">{lang === 'ru' ? 'Устройства' : 'Devices'}</p>
                <h3 style={{ marginTop: '8px' }}>{uniqueDevices.length}</h3>
                <p className="secondary-text" style={{ marginTop: '6px' }}>{uniqueDevices[0] ?? '—'}</p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'trends' && (
          <div className="trends-view animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
             <h1 style={{ marginBottom: '8px' }}>{t.trends}</h1>
             <p className="secondary-text" style={{ marginBottom: '16px' }}>{lang === 'ru' ? 'Анализ прогресса за все время' : 'Progress analysis over time'}</p>

             <div className="premium-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '20px' }}>
                  <div>
                    <h3 style={{ marginBottom: '8px' }}>{lang === 'ru' ? 'Heatmap активности' : 'Activity heatmap'}</h3>
                    <p className="secondary-text">{lang === 'ru' ? 'GitHub-style сетка по дням с цветом нагрузки.' : 'GitHub-style day grid colored by training load.'}</p>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span className="secondary-text" style={{ fontSize: '0.78rem' }}>{lang === 'ru' ? 'меньше' : 'less'}</span>
                    {['rgba(255,255,255,0.05)', 'rgba(52,199,89,0.25)', 'rgba(52,199,89,0.45)', 'rgba(0,122,255,0.55)', 'rgba(255,45,85,0.7)'].map((color) => (
                      <span key={color} style={{ width: '12px', height: '12px', borderRadius: '4px', background: color }} />
                    ))}
                    <span className="secondary-text" style={{ fontSize: '0.78rem' }}>{lang === 'ru' ? 'больше' : 'more'}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', overflowX: 'auto', paddingBottom: '6px' }}>
                  {activityHeatmap.map((week, weekIndex) => (
                    <div key={`week-${weekIndex}`} style={{ display: 'grid', gridTemplateRows: 'repeat(7, 14px)', gap: '6px' }}>
                      {week.map((day) => {
                        const bg = day.level === 4
                          ? 'rgba(255,45,85,0.7)'
                          : day.level === 3
                            ? 'rgba(0,122,255,0.55)'
                            : day.level === 2
                              ? 'rgba(52,199,89,0.45)'
                              : day.level === 1
                                ? 'rgba(52,199,89,0.25)'
                                : 'rgba(255,255,255,0.05)';
                        const label = day.entries.length > 0
                          ? `${day.date.toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US')}: ${day.entries.length} • load ${Math.round(day.load)}`
                          : `${day.date.toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US')}: 0`;
                        return <div key={day.key} title={label} style={{ width: '14px', height: '14px', borderRadius: '4px', background: bg, border: '1px solid rgba(255,255,255,0.05)' }} />;
                      })}
                    </div>
                  ))}
                </div>
             </div>

             {/* Distance Chart */}
             <div className="premium-card" style={{ height: '360px' }}>
                <h3 style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                   <MapPin size={18} className="accent-text" /> {t.distance} (km)
                </h3>
                <div style={{ width: '100%', height: '260px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={history.map((w) => ({ 
                        name: new Date(w.startDate).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short' }), 
                        distance: w.distance 
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#a0a0a0', fontSize: 11}} />
                      <YAxis axisLine={false} tickLine={false} tick={{fill: '#a0a0a0', fontSize: 11}} />
                      <Tooltip 
                        cursor={{fill: 'rgba(255,255,255,0.03)'}}
                        contentStyle={{ background: '#121212', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} 
                        itemStyle={{ color: '#fff' }}
                      />
                      <Bar dataKey="distance" fill="#007aff" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
             </div>

             <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                {/* Heart Rate Trend */}
                <div className="premium-card" style={{ height: '360px' }}>
                    <h3 style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Heart size={18} style={{ color: '#ff9500' }} /> {lang === 'ru' ? 'Ср. Пульс (bpm)' : 'Avg HR (bpm)'}
                    </h3>
                    <div style={{ width: '100%', height: '260px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={history.map((w) => ({ 
                                name: new Date(w.startDate).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short' }), 
                                hr: w.avgHeartRate 
                            }))}>
                                <defs>
                                    <linearGradient id="colorHr" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#ff9500" stopOpacity={0.3}/>
                                        <stop offset="95%" stopColor="#ff9500" stopOpacity={0}/>
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#a0a0a0', fontSize: 11}} />
                                <YAxis axisLine={false} tickLine={false} tick={{fill: '#a0a0a0', fontSize: 11}} domain={['dataMin - 10', 'dataMax + 10']} />
                                <Tooltip 
                                    contentStyle={{ background: '#121212', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} 
                                    itemStyle={{ color: '#fff' }}
                                />
                                <Area type="monotone" dataKey="hr" stroke="#ff9500" strokeWidth={3} fillOpacity={1} fill="url(#colorHr)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Pace Trend */}
                <div className="premium-card" style={{ height: '360px' }}>
                    <h3 style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Zap size={18} style={{ color: '#ff2d55' }} /> {t.pace} (min/km)
                    </h3>
                    <div style={{ width: '100%', height: '260px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={history.map((w) => {
                                const p = w.pace.split('′');
                                const min = parseInt(p[0]) || 0;
                                const sec = parseInt(p[1]) || 0;
                                return {
                                    name: new Date(w.startDate).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short' }), 
                                    pace: parseFloat((min + sec/60).toFixed(2)),
                                    label: w.pace
                                };
                            })}>
                                <defs>
                                    <linearGradient id="colorPace" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#ff2d55" stopOpacity={0.3}/>
                                        <stop offset="95%" stopColor="#ff2d55" stopOpacity={0}/>
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#a0a0a0', fontSize: 11}} />
                                <YAxis axisLine={false} tickLine={false} tick={{fill: '#a0a0a0', fontSize: 11}} domain={['dataMin - 1', 'dataMax + 1']} />
                                <Tooltip 
                                    contentStyle={{ background: '#121212', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} 
                                    itemStyle={{ color: '#fff' }}
                                    formatter={(v, n, p) => [p.payload.label, t.pace]}
                                />
                                <Area type="monotone" dataKey="pace" stroke="#ff2d55" strokeWidth={3} fillOpacity={1} fill="url(#colorPace)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
             </div>
             
             <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '40px' }}>
                <div className="premium-card">
                    <p className="secondary-text">{lang === 'ru' ? 'Общая дистанция' : 'Total Distance'}</p>
                    <h3 style={{ fontSize: '1.8rem' }}>{history.reduce((a, b) => a + b.distance, 0).toFixed(1)} km</h3>
                </div>
                <div className="premium-card">
                    <p className="secondary-text">{lang === 'ru' ? 'Всего калорий' : 'Total Calories'}</p>
                    <h3 style={{ fontSize: '1.8rem' }}>{history.reduce((a, b) => a + b.calories, 0).toLocaleString()} kcal</h3>
                </div>
                <div className="premium-card">
                    <p className="secondary-text">{lang === 'ru' ? 'Средний пульс' : 'Avg Heart Rate'}</p>
                    <h3 style={{ fontSize: '1.8rem' }}>{Math.round(history.reduce((a, b) => a + b.avgHeartRate, 0) / (history.length || 1))} bpm</h3>
                </div>
             </div>
          </div>
        )}

        {activeTab === 'goals' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div>
              <h1 style={{ marginBottom: '8px' }}>{t.goals}</h1>
              <p className="secondary-text">
                {lang === 'ru'
                  ? 'Цели месяца и ключевые прогресс-бары по объёму, частоте, пульсу и темпу.'
                  : 'Monthly goals and key progress bars for volume, frequency, heart rate, and pace.'}
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              {[
                {
                  title: lang === 'ru' ? '50 км за месяц' : '50 km this month',
                  current: `${monthDistance.toFixed(1)} / ${monthlyDistanceGoal} km`,
                  progress: monthlyDistanceProgress,
                  color: '#007aff',
                },
                {
                  title: lang === 'ru' ? '10 тренировок за месяц' : '10 workouts this month',
                  current: `${currentMonthWorkoutsCount} / ${monthlyWorkoutGoal}`,
                  progress: monthlyWorkoutProgress,
                  color: '#34c759',
                },
                {
                  title: lang === 'ru' ? 'Снизить средний пульс до 130' : 'Lower average HR to 130',
                  current: monthAvgHr ? `${monthAvgHr} bpm / ${avgHrGoal}` : '—',
                  progress: avgHrProgress,
                  color: '#ff9500',
                },
                {
                  title: lang === 'ru' ? 'Лучший темп быстрее 8:30' : 'Best pace faster than 8:30',
                  current: bestWorkoutAllTime ? `${bestWorkoutAllTime.pace}/km` : '—',
                  progress: paceGoalProgress,
                  color: '#ff2d55',
                },
              ].map((goal) => (
                <div key={goal.title} className="premium-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', marginBottom: '12px' }}>
                    <h3 style={{ fontSize: '1.05rem' }}>{goal.title}</h3>
                    <span style={{ color: goal.color, fontWeight: 800 }}>{goal.progress}%</span>
                  </div>
                  <p className="secondary-text" style={{ marginBottom: '14px' }}>{goal.current}</p>
                  <div style={{ height: '10px', borderRadius: '999px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden', marginBottom: '12px' }}>
                    <div style={{ width: `${goal.progress}%`, height: '100%', background: goal.color, borderRadius: '999px' }} />
                  </div>
                  <p style={{ fontSize: '0.84rem', color: '#d1d7e0' }}>
                    {goal.progress >= 100
                      ? (lang === 'ru' ? 'Цель выполнена.' : 'Goal completed.')
                      : (lang === 'ru' ? 'Есть прогресс, можно добивать дальше.' : 'Good progress, keep pushing.')}
                  </p>
                </div>
              ))}
            </div>

            <div>
              <h2 style={{ marginBottom: '14px' }}>{lang === 'ru' ? 'Цели нового уровня' : 'Advanced goals'}</h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                {advancedGoals.map((goal) => (
                  <div key={goal.title} className="premium-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', marginBottom: '12px' }}>
                      <h3 style={{ fontSize: '1.05rem' }}>{goal.title}</h3>
                      <span style={{ color: goal.color, fontWeight: 800 }}>{goal.progress}%</span>
                    </div>
                    <p className="secondary-text" style={{ marginBottom: '14px' }}>{goal.current}</p>
                    <div style={{ height: '10px', borderRadius: '999px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden', marginBottom: '12px' }}>
                      <div style={{ width: `${goal.progress}%`, height: '100%', background: goal.color, borderRadius: '999px' }} />
                    </div>
                    <p style={{ fontSize: '0.84rem', color: '#d1d7e0' }}>{goal.note}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="premium-card" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
              <div>
                <p className="secondary-text">{lang === 'ru' ? 'Текущий лучший результат' : 'Current best result'}</p>
                <h3 style={{ marginTop: '8px' }}>{bestWorkoutAllTime ? `${bestWorkoutAllTime.distance.toFixed(2)} km @ ${bestWorkoutAllTime.pace}/km` : '—'}</h3>
              </div>
              <div>
                <p className="secondary-text">{lang === 'ru' ? 'Тренировок в месяце' : 'Workouts this month'}</p>
                <h3 style={{ marginTop: '8px' }}>{currentMonthWorkoutsCount}</h3>
              </div>
              <div>
                <p className="secondary-text">{lang === 'ru' ? 'Средний темп лучшей недели' : 'Best week pace trend'}</p>
                <h3 style={{ marginTop: '8px' }}>{currentWeekSummary.bestPaceWorkout ? `${currentWeekSummary.bestPaceWorkout.pace}/km` : '—'}</h3>
              </div>
             </div>
          </div>
        )}

        {activeTab === 'health-flags' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div>
              <h1 style={{ marginBottom: '8px' }}>{t.healthFlags}</h1>
              <p className="secondary-text">
                {lang === 'ru'
                  ? 'Экран сигналов, которые стоит проверить: перегруз, пульс, резкие просадки и тяжёлые серии.'
                  : 'Signals worth reviewing: overload, heart rate drift, sharp drops, and hard workout streaks.'}
              </p>
            </div>

            {healthFlags.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                {healthFlags.map((flag) => (
                  <div key={flag.title} className="premium-card" style={{ borderColor: `${flag.color}33`, background: 'rgba(255,255,255,0.03)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', marginBottom: '12px' }}>
                      <h3 style={{ color: flag.color }}>{flag.title}</h3>
                      <span style={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.05em', color: flag.color }}>
                        {flag.severity === 'high'
                          ? (lang === 'ru' ? 'HIGH' : 'HIGH')
                          : (lang === 'ru' ? 'MEDIUM' : 'MEDIUM')}
                      </span>
                    </div>
                    <p style={{ color: '#ced6e0', lineHeight: 1.6 }}>{flag.detail}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="premium-card" style={{ padding: '32px', textAlign: 'center' }}>
                <ShieldAlert size={38} style={{ marginBottom: '14px', color: '#34c759' }} />
                <h3 style={{ marginBottom: '8px', color: '#34c759' }}>
                  {lang === 'ru' ? 'Явных красных флагов не найдено' : 'No major red flags detected'}
                </h3>
                <p className="secondary-text">
                  {lang === 'ru'
                    ? 'Текущие данные не показывают резких провалов или перегруза по простым правилам контроля.'
                    : 'Current data does not show sharp drop-offs or overload under the basic monitoring rules.'}
                </p>
              </div>
            )}

            <div className="premium-card" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '18px' }}>
              <div>
                <p className="secondary-text">{lang === 'ru' ? 'Последняя тренировка' : 'Latest workout'}</p>
                <h3 style={{ marginTop: '8px' }}>{history[0] ? `${history[0].distance.toFixed(1)} km · HR ${history[0].avgHeartRate}` : '—'}</h3>
              </div>
              <div>
                <p className="secondary-text">{lang === 'ru' ? 'Недельная нагрузка' : 'Weekly load'}</p>
                <h3 style={{ marginTop: '8px', color: weeklyLoadStatus.color }}>{weeklyLoadStatus.label}</h3>
              </div>
              <div>
                <p className="secondary-text">{lang === 'ru' ? 'Восстановление' : 'Recovery'}</p>
                <h3 style={{ marginTop: '8px', color: weeklyRecoveryStatus.color }}>{weeklyRecoveryStatus.label}</h3>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'report' && (
          <div className="animate-fade-in no-print" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <div>
                <h1 style={{ marginBottom: '8px' }}>{t.report}</h1>
                <p className="secondary-text">
                  {lang === 'ru'
                    ? 'Coach brief: краткий отчёт по форме, рискам, успехам и следующему шагу.'
                    : 'Coach brief: concise report on fitness, risks, wins, and the next step.'}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={handleExportReportPdf}
                  disabled={isReportSaving}
                  style={{ background: 'rgba(88,86,214,0.14)', color: '#9f9cff', border: '1px solid rgba(159,156,255,0.28)', padding: '12px 18px', borderRadius: '12px', cursor: isReportSaving ? 'wait' : 'pointer', fontWeight: 700 }}
                >
                  {isReportSaving
                    ? (lang === 'ru' ? 'Сохраняю...' : 'Saving...')
                    : 'Export PDF'}
                </button>
                <button
                  onClick={handleSaveReportCard}
                  disabled={isReportSaving}
                  style={{ background: 'rgba(0,122,255,0.12)', color: '#57a6ff', border: '1px solid rgba(87,166,255,0.25)', padding: '12px 18px', borderRadius: '12px', cursor: isReportSaving ? 'wait' : 'pointer', fontWeight: 700 }}
                >
                  {isReportSaving
                    ? (lang === 'ru' ? 'Сохраняю...' : 'Saving...')
                    : (lang === 'ru' ? 'Экспорт PNG' : 'Export PNG')}
                </button>
              </div>
            </div>

            <div
              ref={reportCardRef}
              className="premium-card"
              style={{
                padding: '36px',
                background: 'radial-gradient(circle at top left, rgba(0,122,255,0.22), transparent 32%), radial-gradient(circle at bottom right, rgba(52,199,89,0.18), transparent 28%), linear-gradient(160deg, #05070b 0%, #0b1220 55%, #101820 100%)',
                borderColor: 'rgba(255,255,255,0.1)',
                display: 'flex',
                flexDirection: 'column',
                gap: '28px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '20px' }}>
                <div>
                  <p style={{ color: '#8aa0b7', fontSize: '0.85rem', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>RunForm Coach Brief</p>
                  <h1 style={{ fontSize: '2.6rem', marginBottom: '8px' }}>{fitnessIndex.label}</h1>
                  <p style={{ color: '#c7d2df', maxWidth: '640px', lineHeight: 1.6 }}>
                    {lang === 'ru'
                      ? 'Короткий coach brief объединяет wins, risks, smart labels и следующий рекомендуемый шаг.'
                      : 'This coach brief combines wins, risks, smart labels, and the next recommended step.'}
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '3rem', fontWeight: 800, color: fitnessIndex.color }}>{fitnessIndex.value}</div>
                  <p className="secondary-text">Fitness Score</p>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
                <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(255,255,255,0.04)' }}>
                  <p className="secondary-text">{lang === 'ru' ? 'Недельный объём' : 'Weekly volume'}</p>
                  <h3 style={{ marginTop: '8px' }}>{currentWeekSummary.distance.toFixed(1)} km</h3>
                </div>
                <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(255,255,255,0.04)' }}>
                  <p className="secondary-text">{lang === 'ru' ? 'Нагрузка' : 'Load'}</p>
                  <h3 style={{ marginTop: '8px', color: weeklyLoadStatus.color }}>{weeklyLoadStatus.label}</h3>
                </div>
                <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(255,255,255,0.04)' }}>
                  <p className="secondary-text">{lang === 'ru' ? 'Восстановление' : 'Recovery'}</p>
                  <h3 style={{ marginTop: '8px', color: weeklyRecoveryStatus.color }}>{weeklyRecoveryStatus.label}</h3>
                </div>
                <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(255,255,255,0.04)' }}>
                  <p className="secondary-text">{lang === 'ru' ? 'Красные флаги' : 'Health flags'}</p>
                  <h3 style={{ marginTop: '8px' }}>{healthFlags.length}</h3>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '20px' }}>
                <div style={{ padding: '22px', borderRadius: '22px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <p style={{ color: '#8aa0b7', fontSize: '0.8rem', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    {lang === 'ru' ? 'Вывод' : 'Summary'}
                  </p>
                  <p style={{ color: '#e7edf5', lineHeight: 1.7 }}>
                    {lang === 'ru'
                      ? `Форма оценивается как "${fitnessIndex.label}". Недельная нагрузка: "${weeklyLoadStatus.label}", восстановление: "${weeklyRecoveryStatus.label}". ${healthFlags.length > 0 ? `Есть ${healthFlags.length} сигнала, на которые стоит обратить внимание.` : 'Явных красных флагов сейчас не видно.'}`
                      : `Current shape is rated "${fitnessIndex.label}". Weekly load is "${weeklyLoadStatus.label}", recovery is "${weeklyRecoveryStatus.label}". ${healthFlags.length > 0 ? `There are ${healthFlags.length} signals worth attention.` : 'No clear red flags are visible right now.'}`}
                  </p>
                  {workout && (
                    <div style={{ marginTop: '18px', paddingTop: '18px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                      <p className="secondary-text" style={{ marginBottom: '8px' }}>{lang === 'ru' ? 'Последняя выбранная тренировка' : 'Latest selected workout'}</p>
                      <h3 style={{ marginBottom: '6px' }}>{workout.name}</h3>
                      <p style={{ color: '#d0d8e2' }}>
                        {workout.distance.toFixed(2)} km · {formatTime(workout.duration)} · HR {workout.avgHeartRate} bpm · {workout.pace}/km
                      </p>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
                        {getSmartWorkoutLabels(workout).map((tag) => (
                          <span key={tag.label} style={{ padding: '5px 9px', borderRadius: '999px', background: tag.bg, color: tag.color, fontSize: '0.72rem', fontWeight: 700 }}>
                            {tag.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {[
                    { label: lang === 'ru' ? '50 км / месяц' : '50 km / month', progress: monthlyDistanceProgress, color: '#007aff' },
                    { label: lang === 'ru' ? '10 тренировок / месяц' : '10 workouts / month', progress: monthlyWorkoutProgress, color: '#34c759' },
                    { label: lang === 'ru' ? 'Средний HR' : 'Average HR', progress: avgHrProgress, color: '#ff9500' },
                    { label: lang === 'ru' ? 'Лучший темп' : 'Best pace', progress: paceGoalProgress, color: '#ff2d55' },
                  ].map((item) => (
                    <div key={item.label} style={{ padding: '16px', borderRadius: '18px', background: 'rgba(255,255,255,0.04)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span>{item.label}</span>
                        <span style={{ color: item.color, fontWeight: 800 }}>{item.progress}%</span>
                      </div>
                      <div style={{ height: '8px', borderRadius: '999px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                        <div style={{ width: `${item.progress}%`, height: '100%', background: item.color }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(52,199,89,0.05)', border: '1px solid rgba(52,199,89,0.1)' }}>
                  <p className="secondary-text" style={{ marginBottom: '10px' }}>{lang === 'ru' ? 'Key Wins' : 'Key Wins'}</p>
                  {coachBrief.wins.length > 0 ? coachBrief.wins.map((win) => (
                    <p key={win} style={{ lineHeight: 1.6, marginBottom: '8px' }}>{win}</p>
                  )) : <p style={{ lineHeight: 1.6 }}>{lang === 'ru' ? 'Пока без ярко выраженных выигрышей недели.' : 'No standout wins this week yet.'}</p>}
                </div>
                <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(255,149,0,0.05)', border: '1px solid rgba(255,149,0,0.1)' }}>
                  <p className="secondary-text" style={{ marginBottom: '10px' }}>{lang === 'ru' ? 'Risks' : 'Risks'}</p>
                  {coachBrief.risks.length > 0 ? coachBrief.risks.map((risk) => (
                    <p key={risk} style={{ lineHeight: 1.6, marginBottom: '8px' }}>{risk}</p>
                  )) : <p style={{ lineHeight: 1.6 }}>{lang === 'ru' ? 'Критичных рисков сейчас не видно.' : 'No critical risks stand out right now.'}</p>}
                </div>
                <div style={{ padding: '18px', borderRadius: '18px', background: 'rgba(0,122,255,0.05)', border: '1px solid rgba(0,122,255,0.1)' }}>
                  <p className="secondary-text" style={{ marginBottom: '10px' }}>{lang === 'ru' ? 'Next Recommendation' : 'Next Recommendation'}</p>
                  <p style={{ lineHeight: 1.6 }}>{coachBrief.nextRecommendation}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'ai-coach' && (
          <div className="animate-fade-in no-print" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div>
              <h1 style={{ marginBottom: '8px' }}>{t.aiCoach}</h1>
              <p className="secondary-text">
                {lang === 'ru' ? 'AI-слой поверх новых метрик из БД: интенсивность, MET-load, зоны, погода, восстановление и прогноз.' : 'AI layer on top of the new DB metrics: intensity, MET load, zones, weather, recovery, and forecasting.'}
              </p>
            </div>

            {!workout ? (
              <div className="premium-card" style={{ textAlign: 'center', padding: '48px 32px' }}>
                <AlertCircle size={40} style={{ marginBottom: '12px' }} />
                <p style={{ marginBottom: '16px' }}>
                  {lang === 'ru' ? 'Сначала импортируйте тренировку, чтобы получить рекомендации.' : 'Import a workout first to get recommendations.'}
                </p>
                <button
                  onClick={() => setActiveTab('dashboard')}
                  style={{ background: '#5856d6', color: '#fff', border: 'none', padding: '12px 18px', borderRadius: '12px', cursor: 'pointer', fontWeight: 600 }}
                >
                  {lang === 'ru' ? 'Перейти на дашборд' : 'Go to dashboard'}
                </button>
              </div>
            ) : (
              <>
                <div className="premium-card" style={{ background: 'linear-gradient(135deg, rgba(88, 86, 214, 0.1) 0%, rgba(0, 122, 255, 0.05) 100%)', border: '1px solid rgba(88, 86, 214, 0.2)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: aiResponse ? '16px' : '0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ background: '#5856d6', padding: '8px', borderRadius: '10px', color: '#fff' }}>
                        <Sparkles size={20} />
                      </div>
                      <div>
                        <h3 style={{ fontSize: '1.1rem' }}>{t.aiCoach} (Qwen 2.5)</h3>
                        {!aiResponse && <p className="secondary-text" style={{ fontSize: '0.85rem' }}>{lang === 'ru' ? 'Глубокий разбор поверх локально рассчитанного контекста' : 'Deep review on top of locally computed context'}</p>}
                      </div>
                    </div>
                    <button
                      disabled={isAiLoading}
                      onClick={fetchAIAdvice}
                      style={{ background: '#5856d6', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                      {isAiLoading ? <Loader2 size={18} className="animate-spin" /> : t.getAdvice}
                    </button>
                  </div>
                  {aiResponse ? (
                    <div className="animate-fade-in" style={{ padding: '16px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.05)', lineHeight: '1.6', whiteSpace: 'pre-line' }}>
                      {aiResponse}
                    </div>
                  ) : (
                    <div style={{ marginTop: '20px', padding: '20px', borderRadius: '12px', border: '1px dashed rgba(255,255,255,0.12)', color: '#a0a0a0' }}>
                      {lang === 'ru'
                        ? 'Нажмите кнопку выше, чтобы получить разбор, который учитывает интенсивность, MET-load, зоны, погоду и восстановление.'
                        : 'Use the button above to get a review that accounts for intensity, MET load, zones, weather, and recovery.'}
                    </div>
                  )}
                </div>

                <AiCoachDashboard
                  lang={lang}
                  workoutAiReview={workoutAiReview}
                  weeklyCoach={weeklyCoach}
                  nextResultPrediction={nextResultPrediction}
                  explainedFlags={explainedFlags}
                  metricExplainers={metricExplainers}
                  selectedMetricKey={selectedMetricKey}
                  onMetricSelect={setSelectedMetricKey}
                />
              </>
            )}
          </div>
        )}

        {activeTab === 'next-workout' && (
          <div className="animate-fade-in no-print" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div>
              <h1 style={{ marginBottom: '8px' }}>{t.nextWorkout}</h1>
              <p className="secondary-text">
                {lang === 'ru' ? 'Отдельная страница генерации плана на основе последних тренировок.' : 'Dedicated page for generating a plan from recent workouts.'}
              </p>
            </div>

            {history.length === 0 ? (
              <div className="premium-card" style={{ textAlign: 'center', padding: '48px 32px' }}>
                <AlertCircle size={40} style={{ marginBottom: '12px' }} />
                <p style={{ marginBottom: '16px' }}>
                  {lang === 'ru' ? 'Нужна хотя бы одна тренировка в истории, чтобы построить план.' : 'At least one workout in history is required to build a plan.'}
                </p>
                <button
                  onClick={() => setActiveTab('history')}
                  style={{ background: '#34c759', color: '#000', border: 'none', padding: '12px 18px', borderRadius: '12px', cursor: 'pointer', fontWeight: 600 }}
                >
                  {lang === 'ru' ? 'Открыть историю' : 'Open history'}
                </button>
              </div>
            ) : (
              <div className="premium-card" style={{ border: '1px solid rgba(52, 199, 89, 0.2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
                  <div style={{ background: '#34c759', padding: '8px', borderRadius: '10px', color: '#fff' }}>
                    <TrendingUp size={20} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '1.1rem' }}>{t.nextWorkout}</h3>
                    <p className="secondary-text" style={{ fontSize: '0.85rem' }}>
                      {lang === 'ru' ? 'Выберите цель для персонального плана' : 'Choose a goal for a personalized plan'}
                    </p>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '20px' }}>
                  {[
                    { key: 'fat_loss' as const, emoji: '🔥', title: lang === 'ru' ? 'Похудеть' : 'Fat Loss', subtitle: lang === 'ru' ? 'Z1–Z2, длинно и медленно' : 'Z1–Z2, long & slow', color: '#ff9500' },
                    { key: 'endurance' as const, emoji: '💪', title: lang === 'ru' ? 'Выносливость' : 'Endurance', subtitle: lang === 'ru' ? 'Z2–Z3, аэробная база' : 'Z2–Z3, aerobic base', color: '#007aff' },
                    { key: 'speed' as const, emoji: '⚡', title: lang === 'ru' ? 'Скорость' : 'Speed', subtitle: lang === 'ru' ? 'Z4–Z5, интервалы' : 'Z4–Z5, intervals', color: '#ff2d55' },
                  ].map(goal => {
                    const isActive = trainingGoal === goal.key;
                    return (
                      <button
                        key={goal.key}
                        onClick={() => { setTrainingGoal(goal.key); setPlanPhases([]); setAiPlan(''); }}
                        style={{
                          padding: '16px',
                          borderRadius: '14px',
                          border: isActive ? `2px solid ${goal.color}` : '1px solid rgba(255,255,255,0.08)',
                          background: isActive ? `${goal.color}15` : 'rgba(255,255,255,0.03)',
                          cursor: 'pointer',
                          textAlign: 'left',
                          transition: 'all 0.2s ease',
                        }}
                      >
                        <div style={{ fontSize: '1.6rem', marginBottom: '8px' }}>{goal.emoji}</div>
                        <p style={{ fontWeight: 700, fontSize: '0.95rem', color: isActive ? goal.color : '#fff', marginBottom: '4px' }}>{goal.title}</p>
                        <p style={{ fontSize: '0.75rem', color: '#a0a0a0', lineHeight: 1.3 }}>{goal.subtitle}</p>
                      </button>
                    );
                  })}
                </div>

                <button
                  disabled={isPlanLoading || !trainingGoal}
                  onClick={fetchAIPlan}
                  style={{
                    width: '100%',
                    background: trainingGoal ? '#34c759' : 'rgba(255,255,255,0.05)',
                    color: trainingGoal ? '#000' : '#a0a0a0',
                    border: 'none',
                    padding: '14px',
                    borderRadius: '12px',
                    fontWeight: 700,
                    fontSize: '0.95rem',
                    cursor: trainingGoal ? 'pointer' : 'not-allowed',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    transition: 'all 0.2s ease',
                  }}
                >
                  {isPlanLoading ? <Loader2 size={18} className="animate-spin" /> : (trainingGoal ? t.generatePlan : (lang === 'ru' ? '← Выберите цель выше' : '← Choose a goal above'))}
                </button>

                <NextWorkoutInsights
                  lang={lang}
                  weeklyLoadLabel={weeklyLoadStatus.label}
                  recoveryLabel={weeklyRecoveryStatus.label}
                  healthFlagsCount={healthFlags.length}
                  nextResultPrediction={nextResultPrediction}
                />

                {planPhases.length > 0 && (
                  <div className="animate-fade-in" style={{ marginTop: '20px' }}>
                    <p style={{ fontWeight: 600, color: '#34c759', marginBottom: '16px', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {t.planAdvice}
                    </p>
                    {planPhases.map((phase, idx) => {
                      const zoneColors: Record<string, string> = { Z1: '#34c759', Z2: '#007aff', Z3: '#ff9500', Z4: '#ff2d55', Z5: '#bf5af2' };
                      const phaseIcons: Record<string, string> = { Warmup: '🔥', 'Easy Run': '🏃', Tempo: '⚡', Interval: '🔁', Recovery: '💚', Cooldown: '❄️' };
                      const color = zoneColors[phase.zone] || '#a0a0a0';
                      const icon = phaseIcons[phase.phase] || '📍';
                      return (
                        <div key={idx} style={{ display: 'flex', gap: '16px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '28px' }}>
                            <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', flexShrink: 0 }}>
                              {icon}
                            </div>
                            {idx < planPhases.length - 1 && <div style={{ width: '2px', flex: 1, background: `${color}40`, minHeight: '16px', margin: '4px 0' }} />}
                          </div>
                          <div style={{ flex: 1, background: `${color}08`, border: `1px solid ${color}25`, borderRadius: '14px', padding: '14px 16px', marginBottom: '10px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <span style={{ fontWeight: 700 }}>{phase.phase}</span>
                                <span style={{ background: color, color: '#fff', fontSize: '0.7rem', fontWeight: 800, padding: '2px 8px', borderRadius: '6px' }}>{phase.zone}</span>
                              </div>
                              <span style={{ fontWeight: 700, color, fontSize: '1.05rem' }}>{phase.duration}</span>
                            </div>
                            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                              <div><p style={{ fontSize: '0.7rem', opacity: 0.4, marginBottom: '2px' }}>ПУЛЬС</p><p style={{ fontSize: '0.88rem', fontWeight: 600, color }}>{phase.hr_range}</p></div>
                              <div><p style={{ fontSize: '0.7rem', opacity: 0.4, marginBottom: '2px' }}>ТЕМП</p><p style={{ fontSize: '0.88rem', fontWeight: 600 }}>{phase.pace}</p></div>
                              <div style={{ flex: 1 }}><p style={{ fontSize: '0.7rem', opacity: 0.4, marginBottom: '2px' }}>СОВЕТ</p><p style={{ fontSize: '0.83rem', opacity: 0.75 }}>{phase.notes}</p></div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {aiPlan && planPhases.length === 0 && (
                  <div className="animate-fade-in" style={{ padding: '16px', background: 'rgba(52, 199, 89, 0.05)', borderRadius: '12px', border: '1px solid rgba(52, 199, 89, 0.1)', whiteSpace: 'pre-line', marginTop: '16px' }}>
                    <p style={{ fontWeight: 600, color: '#34c759', marginBottom: '8px' }}>{t.planAdvice}:</p>
                    {aiPlan}
                  </div>
                )}

              </div>
            )}
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="settings-view animate-fade-in">
             <h1 style={{ marginBottom: '32px' }}>{t.settings}</h1>
             <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '600px' }}>
                <div className="premium-card">
                    <h3 style={{ marginBottom: '16px' }}>{lang === 'ru' ? 'Профиль' : 'Profile'}</h3>
                    <input
                      value={profileName}
                      onChange={(event) => setProfileName(event.target.value)}
                      placeholder={lang === 'ru' ? 'Введите имя' : 'Enter your name'}
                      style={{
                        width: '100%',
                        padding: '14px 16px',
                        borderRadius: '12px',
                        border: '1px solid rgba(255,255,255,0.12)',
                        background: 'rgba(255,255,255,0.04)',
                        color: '#f5f7fb',
                        fontSize: '0.95rem',
                        outline: 'none'
                      }}
                    />
                    <p className="secondary-text" style={{ marginTop: '10px' }}>
                      {lang === 'ru' ? 'Имя сохраняется локально на этом устройстве.' : 'The name is stored locally on this device.'}
                    </p>
                </div>
                <div className="premium-card">
                    <h3 style={{ marginBottom: '16px' }}>{lang === 'ru' ? 'Персонализация зон' : 'Zone Personalization'}</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                      {(['z1', 'z2', 'z3', 'z4', 'z5'] as const).map((zone, idx) => (
                        <div key={zone}>
                          <label className="secondary-text" style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem' }}>
                            {lang === 'ru' ? `Зона ${idx + 1} (мин. пульс)` : `Zone ${idx + 1} (min HR)`}
                          </label>
                          <input
                            type="number"
                            value={preferences.hrZones[zone]}
                            onChange={(e) => setPreferences({
                              ...preferences,
                              hrZones: { ...preferences.hrZones, [zone]: parseInt(e.target.value) || 0 }
                            })}
                            style={{
                              width: '100%',
                              padding: '12px 14px',
                              borderRadius: '10px',
                              border: '1px solid rgba(255,255,255,0.12)',
                              background: 'rgba(255,255,255,0.04)',
                              color: '#f5f7fb',
                              fontSize: '0.95rem',
                              outline: 'none'
                            }}
                          />
                        </div>
                      ))}
                      <div>
                        <label className="secondary-text" style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem' }}>
                          {lang === 'ru' ? 'Пороговый темп (сек/км)' : 'Threshold Pace (sec/km)'}
                        </label>
                        <input
                          type="number"
                          value={preferences.thresholdPace}
                          onChange={(e) => setPreferences({
                            ...preferences,
                            thresholdPace: parseInt(e.target.value) || 0
                          })}
                          style={{
                            width: '100%',
                            padding: '12px 14px',
                            borderRadius: '10px',
                            border: '1px solid rgba(255,255,255,0.12)',
                            background: 'rgba(255,255,255,0.04)',
                            color: '#f5f7fb',
                            fontSize: '0.95rem',
                            outline: 'none'
                          }}
                        />
                        <p className="secondary-text" style={{ fontSize: '0.75rem', marginTop: '6px' }}>
                           {lang === 'ru' ? 'Например: 300 для темпа 5:00/км' : 'Example: 300 for 5:00/km pace'}
                        </p>
                      </div>
                    </div>
                </div>
                <div className="premium-card">
                    <h3 style={{ marginBottom: '16px' }}>{lang === 'ru' ? 'Экипировка (Кроссовки)' : 'Equipment (Shoes)'}</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      {shoes.map(shoe => (
                        <div key={shoe.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.04)', padding: '12px 16px', borderRadius: '12px', border: shoe.isActive ? '1px solid rgba(52, 199, 89, 0.3)' : '1px solid rgba(255,255,255,0.1)' }}>
                           <div>
                             <h4 style={{ margin: 0, fontSize: '1.05rem', color: shoe.isActive ? '#fff' : '#a0a0a0' }}>{shoe.name} <span style={{ fontSize: '0.8rem', opacity: 0.6 }}>({shoe.brand} {shoe.model})</span></h4>
                             <p className="secondary-text" style={{ margin: '4px 0 0', fontSize: '0.85rem' }}>
                               {shoe.distanceRun.toFixed(1)} / {shoe.maxDistance} km 
                               <span style={{ marginLeft: '12px', color: shoe.distanceRun > shoe.maxDistance ? '#ff2d55' : 'inherit' }}>
                                 ({Math.round((shoe.distanceRun / shoe.maxDistance) * 100)}%)
                               </span>
                             </p>
                           </div>
                           <button onClick={async () => {
                             const { toggleShoeActive } = await import('@/lib/actions');
                             await toggleShoeActive(shoe.id, !shoe.isActive);
                             await loadShoes();
                           }} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', padding: '6px 12px', borderRadius: '8px', cursor: 'pointer' }}>
                             {shoe.isActive ? (lang === 'ru' ? 'В архив' : 'Archive') : (lang === 'ru' ? 'Активировать' : 'Activate')}
                           </button>
                        </div>
                      ))}
                      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                        <input
                          placeholder={lang === 'ru' ? 'Название (напр. Nike Peg)' : 'Name (e.g. Nike Peg)'}
                          value={newShoe.name}
                          onChange={(e) => setNewShoe({...newShoe, name: e.target.value})}
                          style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: '#fff', outline: 'none' }}
                        />
                        <input
                          placeholder={lang === 'ru' ? 'Макс. км (800)' : 'Max km (800)'}
                          type="number"
                          value={newShoe.maxDistance}
                          onChange={(e) => setNewShoe({...newShoe, maxDistance: parseInt(e.target.value)||800})}
                          style={{ width: '100px', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: '#fff', outline: 'none' }}
                        />
                        <button onClick={async () => {
                          if (newShoe.name) {
                            const { addShoe } = await import('@/lib/actions');
                            await addShoe({ name: newShoe.name, brand: newShoe.brand, model: newShoe.model, maxDistance: newShoe.maxDistance });
                            setNewShoe({ name: '', brand: '', model: '', maxDistance: 800 });
                            await loadShoes();
                          }
                        }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#007aff', color: '#fff', border: 'none', padding: '0 16px', borderRadius: '8px', cursor: 'pointer' }}>
                          <Plus size={18} />
                        </button>
                      </div>
                    </div>
                </div>
                <div className="premium-card">
                    <h3 style={{ marginBottom: '16px' }}>{lang === 'ru' ? 'Приложение' : 'App'}</h3>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>{lang === 'ru' ? 'Версия' : 'Version'}</span>
                          <span className="secondary-text">v{APP_VERSION}</span>
                    </div>
                </div>
                <button 
                    onClick={async () => { if (confirm(lang === 'ru' ? 'Вы уверены? Это сотрет все данные.' : 'Are you sure? This will delete all data.')) { await resetWorkouts(); setActiveTab('dashboard'); } }}
                    style={{ background: 'rgba(255, 45, 85, 0.1)', color: '#ff2d55', border: '1px solid rgba(255, 45, 85, 0.2)', padding: '16px', borderRadius: '12px', cursor: 'pointer', fontWeight: 600 }}
                >
                    {lang === 'ru' ? 'Сбросить базу данных' : 'Reset Database'}
                </button>
             </div>
          </div>
        )}
      </main>
      
      <ShareCardModal
        lang={lang}
        workout={workout}
        show={showShareCard}
        shareCardRef={shareCardRef}
        isShareSaving={isShareSaving}
        onClose={() => setShowShareCard(false)}
        onSave={handleSaveShareCard}
        formatTime={formatTime}
      />
    </div>
  );
}
