import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { Award, CheckCircle2 } from 'lucide-react';
import { db } from '../lib/firebase';
import type { PortalCertificate } from '../types/portal';

export function VerifyCertificatePage() {
  const { code } = useParams<{ code: string }>();
  const [cert, setCert] = useState<PortalCertificate | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!code) {
      setLoading(false);
      return;
    }
    getDoc(doc(db, 'portal_certificates', code))
      .then((snap) => {
        if (snap.exists()) setCert(snap.data() as PortalCertificate);
      })
      .finally(() => setLoading(false));
  }, [code]);

  return (
    <div className="max-w-xl mx-auto px-4 sm:px-6 py-16">
      <div className="rounded-[24px] border border-[#084F4E]/15 bg-white p-8 sm:p-10 text-center shadow-sm">
        <div className="w-14 h-14 rounded-2xl bg-[#E8C97A]/30 text-[#084F4E] flex items-center justify-center mx-auto mb-5">
          <Award className="w-7 h-7" />
        </div>

        {loading ? (
          <p className="text-sm text-[#3F4F4F]">Verifying certificate...</p>
        ) : cert ? (
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#0E7C7B]">
              <CheckCircle2 className="w-4 h-4" />
              <span>Verified Ijwi Certificate</span>
            </div>
            <h1 className="font-display text-3xl font-semibold text-[#084F4E]">
              {cert.learnerName}
            </h1>
            <p className="text-base text-[#1F2A2A]">
              Completed <strong>{cert.levelName}</strong>
            </p>
            <p className="text-sm text-[#3F4F4F]">
              {cert.planName} · Issued {new Date(cert.issuedAt).toLocaleDateString()}
            </p>
            <p className="text-xs font-mono text-[#3F4F4F] pt-3 border-t border-[#084F4E]/10">
              Certificate ID: {cert.certCode}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <h1 className="font-display text-2xl font-semibold text-[#084F4E]">
              Certificate not found
            </h1>
            <p className="text-sm text-[#3F4F4F]">
              No verified certificate matches code {code}.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
