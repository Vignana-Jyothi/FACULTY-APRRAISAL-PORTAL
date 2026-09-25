import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import ProofVerificationPanel from '../../components/ProofVerificationPanel';
import { verificationApi } from '../../api/verification';

// One faculty's uploads, opened from the faculty-wise Uploads list. Reuses the
// same verification panel the reviewer uses on the review screen.
export default function FacultyUploadsPage() {
  const { submissionId = '' } = useParams();
  const [faculty, setFaculty] = useState<{ name: string; employeeCode: string; dept?: string; year?: string } | null>(null);

  useEffect(() => {
    if (!submissionId) return;
    verificationApi.listProofs(submissionId)
      .then((d) => setFaculty({
        name: d.submission.faculty.name,
        employeeCode: d.submission.faculty.employeeCode,
        dept: d.submission.faculty.department?.name,
        year: d.submission.year,
      }))
      .catch(() => setFaculty(null));
  }, [submissionId]);

  return (
    <div>
      <PageHeader
        title={faculty ? `${faculty.name}'s Uploads` : 'Uploads'}
        help="Every proof this faculty uploaded, grouped by subsection. Verify or reject each document; a rejected proof red-lists the submission until it is re-uploaded."
        help="Every proof this faculty uploaded, grouped by subsection. Verify or reject each document; a rejected proof red-lists the submission until it is re-uploaded."
        subtitle={faculty ? `${faculty.employeeCode}${faculty.dept ? ` · ${faculty.dept}` : ''}${faculty.year ? ` · ${faculty.year}` : ''}` : undefined}
        breadcrumbs={[{ label: 'Uploads', to: '/uploads' }, { label: faculty?.name ?? 'Faculty' }]}
      />

      <Link to="/uploads" className="inline-flex items-center gap-1 text-sm text-primary-600 hover:underline mb-3">
        <ArrowLeft size={14} /> Back to all uploads
      </Link>

      <ProofVerificationPanel submissionId={submissionId} />
    </div>
  );
}
