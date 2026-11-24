export type UserRole = 'student' | 'teacher' | 'admin';
export type UserStatus = 'active' | 'suspended';
export type InvoiceStatus = 'unpaid' | 'paid' | 'expired' | 'void' | 'refunded';
export type BookingStatus = 'confirmed' | 'rescheduled' | 'cancelled' | 'completed' | 'no_show' | 'late_cancel';
export type LessonStatus = 'not_started' | 'in_progress' | 'done';

export interface EmailPrefs {
  reminders: boolean;
  weeklyDigest: boolean;
  community: boolean;
  announcements: boolean;
}

export interface PortalUser {
  uid: string;
  email: string;
  displayName: string;
  photoUrl?: string;
  role: UserRole;
  timezone: string;
  organisation?: string;
  status: UserStatus;
  teamId?: string;
  groupId?: string;
  teacherId?: string;
  accessActive: boolean;
  isTeamOwner?: boolean;
  placementLevel?: string;
  noShowCount?: number;
  lateCancelCount?: number;
  adminNote?: string;
  emailPrefs?: EmailPrefs;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface LearningLesson {
  id: string;
  title: string;
  summary: string;
}

export interface LearningLevel {
  id: string;
  title: string;
  description: string;
  lessons: LearningLesson[];
}

export interface PortalPlan {
  id: string;
  name: string;
  description: string;
  unitPriceCents: number;
  currency: string;
  included: string[];
  learningPath: LearningLevel[];
  active: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PortalInvoice {
  id: string;
  number: string;
  payerId: string;
  payerName: string;
  payerEmail: string;
  organisation?: string;
  teamId?: string;
  isTopUp?: boolean;
  planId: string;
  planName: string;
  seats: number;
  ownerIsLearner: boolean;
  unitPriceCents: number;
  subtotalCents: number;
  teamDiscountPct: number;
  teamDiscountCents: number;
  couponCode?: string;
  couponDiscountCents: number;
  totalCents: number;
  currency: string;
  status: InvoiceStatus;
  dueAt: string;
  paidAt?: string;
  pesapalOrderRef?: string;
  pesapalTrackingId?: string;
  paymentMethod?: string;
  paymentUrl?: string;
  manualReason?: string;
  refundReason?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PortalTeam {
  id: string;
  ownerId: string;
  ownerName: string;
  name: string;
  planId: string;
  seatsTotal: number;
  seatsUsed: number;
  invoiceIds?: string[];
  accessActive: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface TeamMember {
  uid: string;
  ownerId: string;
  displayName: string;
  email: string;
  status: 'invited' | 'joined';
  joinedAt?: unknown;
}

export interface PortalInvite {
  id: string;
  teamId: string;
  teamName: string;
  ownerId: string;
  ownerName: string;
  planId: string;
  tokenHash: string;
  email?: string;
  expiresAt: string;
  acceptedBy?: string;
  acceptedAt?: string;
  revoked: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface StudyGroup {
  id: string;
  name: string;
  planId: string;
  teacherId: string;
  teacherName: string;
  capacity: number;
  memberIds: string[];
  memberFirstNames: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface WeeklySlot {
  dayOfWeek: number; // 0 (Sun) - 6 (Sat)
  startHourUtc: number;
  startMinuteUtc: number;
}

export interface TeacherProfile {
  uid: string;
  displayName: string;
  photoUrl: string;
  bio: string;
  availability: WeeklySlot[];
  daysOff: string[]; // YYYY-MM-DD
  lessonLengthMin: number;
  bufferMin: number;
  maxPerDay: number;
  active: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PortalBooking {
  id: string;
  studentId: string;
  studentName: string;
  teacherId: string;
  teacherName: string;
  startUtc: string;
  endUtc: string;
  status: BookingStatus;
  note?: string;
  teacherFeedback?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface LessonProgress {
  studentId: string;
  lessonId: string;
  lessonTitle: string;
  levelTitle: string;
  status: LessonStatus;
  teacherNote?: string;
  completedAt?: string;
  updatedAt?: unknown;
}

export interface PortalResource {
  id: string;
  type: 'pdf' | 'video' | 'link';
  title: string;
  description?: string;
  fileKey?: string;
  url?: string;
  level: string;
  topic: string;
  uploaderId: string;
  uploaderName: string;
  publicToPaid: boolean;
  targetStudentIds?: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface GroupSession {
  id: string;
  creatorId: string;
  creatorName: string;
  title: string;
  topic: string;
  description?: string;
  startUtc: string;
  capacity: number;
  locationType: 'platform' | 'external';
  meetingLink?: string;
  status: 'upcoming' | 'cancelled' | 'completed';
  attendeeIds: string[];
  attendeeNames: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PortalCoupon {
  code: string;
  type: 'percent' | 'fixed';
  value: number;
  startsAt?: string;
  endsAt?: string;
  usageLimit: number;
  usedCount: number;
  perPersonLimit: number;
  planId?: string;
  active: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PortalCertificate {
  certCode: string;
  userId: string;
  learnerName: string;
  levelName: string;
  planName: string;
  issuedAt: string;
  createdAt?: unknown;
}

export interface LessonFeedback {
  id: string;
  bookingId: string;
  studentId: string;
  studentName: string;
  teacherId: string;
  teacherName: string;
  rating: number;
  comment?: string;
  createdAt?: unknown;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  audienceType: 'all' | 'plan' | 'team' | 'group';
  audienceId?: string;
  authorId: string;
  active: boolean;
  createdAt?: unknown;
}

export interface NotificationItem {
  id: string;
  userId: string;
  title: string;
  body: string;
  type: string;
  link?: string;
  read: boolean;
  createdAt?: unknown;
}

export interface PortalSettings {
  currency: string;
  invoiceExpiryDays: number;
  cancelWindowHours: number;
  groupSize: number;
  emailSender: string;
  maxUploadMb: number;
  weeklyFlierNote?: string;
  updatedAt?: unknown;
}
