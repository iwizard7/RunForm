'use client';

import { useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { WorkoutData } from '@/lib/parser';
import { Language } from '@/lib/translations';

export function useWorkoutExports(workout: WorkoutData | null, lang: Language) {
  const [showShareCard, setShowShareCard] = useState(false);
  const [isShareSaving, setIsShareSaving] = useState(false);
  const [isReportSaving, setIsReportSaving] = useState(false);
  const shareCardRef = useRef<HTMLDivElement>(null);
  const dashboardExportRef = useRef<HTMLDivElement>(null);
  const reportCardRef = useRef<HTMLDivElement>(null);

  const handleExport = async () => {
    if (!workout) {
      window.alert(lang === 'ru' ? 'Сначала импортируйте тренировку.' : 'Import a workout first.');
      return;
    }

    if (!dashboardExportRef.current) {
      // The export target only exists while the dashboard is on screen.
      window.alert(
        lang === 'ru'
          ? 'Экспорт доступен на дашборде: откройте «Дашборд» и повторите.'
          : 'Export is available on the dashboard: open “Dashboard” and try again.',
      );
      return;
    }

    try {
      const dataUrl = await toPng(dashboardExportRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: '#05070b',
      });

      const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: 'a4' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const image = new window.Image();
      image.src = dataUrl;

      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('Failed to load dashboard image'));
      });

      const ratio = Math.min(pageWidth / image.width, pageHeight / image.height);
      const width = image.width * ratio;
      const height = image.height * ratio;
      const x = (pageWidth - width) / 2;
      const y = 16;

      pdf.setFillColor(5, 7, 11);
      pdf.rect(0, 0, pageWidth, pageHeight, 'F');
      pdf.addImage(dataUrl, 'PNG', x, y, width, height);
      pdf.save(`training-report-${new Date(workout.startDate).toISOString().slice(0, 10)}.pdf`);
    } catch (error) {
      console.error('Failed to export PDF:', error);
      window.alert(lang === 'ru' ? 'Не удалось экспортировать PDF.' : 'Failed to export PDF.');
    }
  };

  const handleSaveShareCard = async () => {
    if (!shareCardRef.current || !workout) return;

    try {
      setIsShareSaving(true);
      const dataUrl = await toPng(shareCardRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: '#05070b',
      });

      const link = document.createElement('a');
      const dateLabel = new Date(workout.startDate).toISOString().slice(0, 10);
      link.download = `training-card-${dateLabel}.png`;
      link.href = dataUrl;
      link.click();
    } catch (error) {
      console.error('Failed to save share card:', error);
      window.alert(lang === 'ru' ? 'Не удалось сохранить изображение.' : 'Failed to save image.');
    } finally {
      setIsShareSaving(false);
    }
  };

  const handleSaveReportCard = async () => {
    if (!reportCardRef.current) return;

    try {
      setIsReportSaving(true);
      const dataUrl = await toPng(reportCardRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: '#05070b',
      });

      const link = document.createElement('a');
      link.download = `training-report-${new Date().toISOString().slice(0, 10)}.png`;
      link.href = dataUrl;
      link.click();
    } catch (error) {
      console.error('Failed to save report image:', error);
      window.alert(lang === 'ru' ? 'Не удалось сохранить отчёт.' : 'Failed to save report.');
    } finally {
      setIsReportSaving(false);
    }
  };

  const handleExportReportPdf = async () => {
    if (!reportCardRef.current) return;

    try {
      setIsReportSaving(true);
      const dataUrl = await toPng(reportCardRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: '#05070b',
      });

      const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: 'a4' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const image = new window.Image();
      image.src = dataUrl;

      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('Failed to load report image'));
      });

      const ratio = Math.min(pageWidth / image.width, pageHeight / image.height);
      const width = image.width * ratio;
      const height = image.height * ratio;
      const x = (pageWidth - width) / 2;
      const y = 16;

      pdf.setFillColor(5, 7, 11);
      pdf.rect(0, 0, pageWidth, pageHeight, 'F');
      pdf.addImage(dataUrl, 'PNG', x, y, width, height);
      pdf.save(`runform-coach-brief-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (error) {
      console.error('Failed to export report PDF:', error);
      window.alert(lang === 'ru' ? 'Не удалось сохранить PDF отчёта.' : 'Failed to save report PDF.');
    } finally {
      setIsReportSaving(false);
    }
  };

  return {
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
  };
}
