import { jsPDF } from 'jspdf';
import type { PortalInvoice } from '../types/portal';
import { formatMoney } from '../shared/pricing';

export function downloadInvoicePdf(invoice: PortalInvoice): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const isPaid = invoice.status === 'paid';

  // Header
  doc.setFillColor(8, 79, 78); // #084F4E
  doc.rect(0, 0, 595, 92, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('times', 'bold');
  doc.setFontSize(26);
  doc.text('Ijwi', 44, 48);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('Kinyarwanda Language Academy · learn@ijwi.me', 44, 68);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(isPaid ? 'PAYMENT RECEIPT' : 'INVOICE', 551, 48, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(invoice.number, 551, 66, { align: 'right' });

  // Bill To & Metadata
  doc.setTextColor(31, 42, 42);
  let y = 132;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('BILL TO', 44, y);
  doc.text('DETAILS', 360, y);

  y += 18;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(invoice.payerName, 44, y);
  doc.text(`Status: ${invoice.status.toUpperCase()}`, 360, y);

  y += 16;
  doc.text(invoice.payerEmail, 44, y);
  doc.text(`Due date: ${new Date(invoice.dueAt).toLocaleDateString('en-US')}`, 360, y);

  if (invoice.organisation) {
    y += 16;
    doc.text(`Organisation: ${invoice.organisation}`, 44, y);
  }
  if (invoice.paidAt) {
    doc.text(`Paid on: ${new Date(invoice.paidAt).toLocaleDateString('en-US')}`, 360, y);
  }

  // Table header
  y += 38;
  doc.setFillColor(230, 244, 244);
  doc.rect(44, y, 507, 28, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(8, 79, 78);
  doc.text('Description', 56, y + 18);
  doc.text('Seats', 360, y + 18, { align: 'right' });
  doc.text('Unit Price', 450, y + 18, { align: 'right' });
  doc.text('Amount', 539, y + 18, { align: 'right' });

  // Line item
  y += 48;
  doc.setTextColor(31, 42, 42);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  const label = invoice.isTopUp
    ? `${invoice.planName} (Additional team seats)`
    : `${invoice.planName} (${invoice.seats > 1 ? 'Team enrolment' : 'Individual enrolment'})`;
  doc.text(label, 56, y);
  doc.text(String(invoice.seats), 360, y, { align: 'right' });
  doc.text(formatMoney(invoice.unitPriceCents, invoice.currency), 450, y, { align: 'right' });
  doc.text(formatMoney(invoice.subtotalCents, invoice.currency), 539, y, { align: 'right' });

  // Discounts
  y += 28;
  doc.setDrawColor(226, 232, 240);
  doc.line(44, y, 551, y);

  y += 24;
  if (invoice.teamDiscountCents > 0) {
    doc.setTextColor(14, 124, 123);
    doc.text(`Team discount (${invoice.teamDiscountPct}%)`, 310, y);
    doc.text(`-${formatMoney(invoice.teamDiscountCents, invoice.currency)}`, 539, y, { align: 'right' });
    y += 20;
  }

  if (invoice.couponDiscountCents > 0) {
    doc.setTextColor(14, 124, 123);
    doc.text(`Coupon (${invoice.couponCode || 'PROMO'})`, 310, y);
    doc.text(`-${formatMoney(invoice.couponDiscountCents, invoice.currency)}`, 539, y, { align: 'right' });
    y += 20;
  }

  y += 8;
  doc.setDrawColor(8, 79, 78);
  doc.line(300, y, 551, y);
  y += 24;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(8, 79, 78);
  doc.text(isPaid ? 'Total Paid' : 'Total Due', 310, y);
  doc.text(formatMoney(invoice.totalCents, invoice.currency), 539, y, { align: 'right' });

  if (isPaid && invoice.pesapalTrackingId) {
    y += 32;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(63, 79, 79);
    doc.text(
      `Payment Method: ${invoice.paymentMethod || 'Pesapal'} · Reference: ${invoice.pesapalTrackingId}`,
      44,
      y
    );
  }

  // Footer
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 116);
  doc.text('Murakoze cyane — Thank you for learning Kinyarwanda with Ijwi.', 44, 780);

  doc.save(`${invoice.number}.pdf`);
}
