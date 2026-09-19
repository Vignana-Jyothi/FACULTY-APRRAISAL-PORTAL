import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { userApi } from '../../api/users';
import { useAuthStore } from '../../store/authStore';
import toast from 'react-hot-toast';
import { Save, Lock, Eye, EyeOff, Mail, KeyRound, ShieldAlert } from 'lucide-react';

type PwStage = 'verify' | 'otp';

export default function ProfilePage() {
  const navigate = useNavigate();
  const authUser = useAuthStore((s) => s.user);
  // Narrow cast: AuthUser does not declare mustChangePassword (authStore.ts is
  // owned by another change); the login payload carries it on the stored user.
  const storeForced = (authUser as { mustChangePassword?: boolean } | null)?.mustChangePassword === true;
  const [me, setMe] = useState<any>(null);
  // Someone else chose this password (bulk import / admin create). Until it is
  // replaced the server refuses everything else, so show only the password form.
  const forced = storeForced || me?.mustChangePassword === true;
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);

  // Password change state
  const [pwStage, setPwStage] = useState<PwStage>('verify');
  const [currentPassword, setCurrentPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otpHint, setOtpHint] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    userApi.getMe().then((u) => {
      setMe(u);
      setForm({
        name: u.name ?? '',
        email: u.email ?? '',
        phone: u.phone ?? '',
        designation: u.designation ?? '',
        specialization: u.specialization ?? '',
        educationalQuals: u.educationalQuals ?? '',
        contactAddress: u.contactAddress ?? '',
      });
    });
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await userApi.updateProfile(form);
      toast.success('Profile saved');
    } catch {
      toast.error('Save failed');
    } finally {
      setSaving(false);
    }
  };

  const requestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwBusy(true);
    try {
      const r = await userApi.requestPasswordOtp(currentPassword);
      setOtpHint(r.message ?? 'OTP sent');
      setPwStage('otp');
      toast.success('OTP sent to your email');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to send OTP');
    } finally {
      setPwBusy(false);
    }
  };

  const submitChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error('New password and confirm do not match');
      return;
    }
    if (newPassword.length < 8) {
      toast.error('New password must be at least 8 characters');
      return;
    }
    if (otp.length !== 6) {
      toast.error('OTP must be 6 digits');
      return;
    }
    setPwBusy(true);
    try {
      const r = await userApi.changePasswordWithOtp(otp, newPassword);
      // The change ends every session (tokenVersion bump), this one included;
      // the server hands this tab a fresh token. Adopt it before any other call.
      const { user: current, login } = useAuthStore.getState();
      if (r?.accessToken && current) {
        login(r.accessToken, { ...current, mustChangePassword: false } as typeof current);
      }
      toast.success('Password updated');
      if (forced) {
        // Confirm with the server that the flag is gone, then carry on.
        const fresh = await userApi.getMe();
        setMe(fresh);
        const latest = useAuthStore.getState();
        if (latest.user && latest.accessToken) {
          latest.login(latest.accessToken, {
            ...latest.user,
            mustChangePassword: fresh.mustChangePassword === true,
          } as typeof latest.user);
        }
        if (fresh.mustChangePassword !== true) navigate('/dashboard', { replace: true });
        return;
      }
      // Reset all
      setPwStage('verify');
      setCurrentPassword('');
      setOtp('');
      setNewPassword('');
      setConfirmPassword('');
      setOtpHint('');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to change password');
    } finally {
      setPwBusy(false);
    }
  };

  const cancelOtp = () => {
    setPwStage('verify');
    setOtp('');
    setNewPassword('');
    setConfirmPassword('');
    setOtpHint('');
  };

  if (!me) return <div className="text-sm text-ink-muted">Loading...</div>;

  const field = (key: string, label: string, type = 'text') => (
    <div>
      <label className="block text-xs font-medium text-ink-secondary mb-1">{label}</label>
      <input
        type={type}
        value={form[key] ?? ''}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className="w-full border border-surface-border rounded px-3 py-2 text-sm bg-surface-base focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
    </div>
  );

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-ink-primary mb-1">My Profile</h1>
      <p className="text-sm text-ink-muted mb-6">Employee Code: {me.employeeCode}</p>

      {forced && (
        <div role="alert" className="bg-amber-50 border border-amber-300 rounded-md p-4 mb-6 flex items-start gap-3">
          <ShieldAlert size={20} className="text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900">
            <p className="font-semibold">Change your password to continue</p>
            <p className="mt-1">
              Your password was set by an administrator. Choose a new one below before using the
              appraisal system. Enter the password you signed in with, and we'll email a code to
              {' '}<strong>{me.email}</strong> to confirm it's you.
            </p>
          </div>
        </div>
      )}

      {/* Profile */}
      {!forced && (
      <form onSubmit={save} className="bg-surface-card border border-surface-border rounded-md shadow-sm p-6 space-y-4 mb-6">
        <h2 className="text-sm font-semibold text-ink-primary pb-2 border-b border-accent-500/30 font-serif">Personal Information</h2>
        <div className="grid grid-cols-2 gap-4">
          {field('name', 'Name')}
          {field('email', 'Email', 'email')}
          {field('phone', 'Phone')}
          {field('designation', 'Designation')}
          {field('specialization', 'Specialization')}
          {field('educationalQuals', 'Educational Qualifications')}
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-secondary mb-1">Contact Address</label>
          <textarea
            value={form.contactAddress ?? ''}
            onChange={(e) => setForm({ ...form, contactAddress: e.target.value })}
            rows={3}
            className="w-full border border-surface-border rounded px-3 py-2 text-sm bg-surface-base focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded text-sm font-medium flex items-center gap-2 disabled:opacity-50"
        >
          <Save size={16} /> {saving ? 'Saving...' : 'Save Profile'}
        </button>
      </form>
      )}

      {/* Password Change */}
      <div id="change-password" className="bg-surface-card border border-surface-border rounded-md shadow-sm p-6">
        <h2 className="text-sm font-semibold text-ink-primary pb-2 border-b border-accent-500/30 font-serif flex items-center gap-2 mb-4">
          <Lock size={14} /> Change Password
        </h2>

        {pwStage === 'verify' && (
          <form onSubmit={requestOtp} className="space-y-4">
            <p className="text-xs text-ink-muted">
              Enter your current password. We'll email a 6-digit OTP to <strong>{me.email}</strong> to verify it's you.
            </p>

            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">Current Password</label>
              <div className="relative">
                <input
                  type={showCurrent ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  className="w-full border border-surface-border rounded px-3 py-2 pr-10 text-sm bg-surface-base focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <button type="button" onClick={() => setShowCurrent(!showCurrent)} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-subtle hover:text-ink-primary">
                  {showCurrent ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={pwBusy || !currentPassword}
              className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded text-sm font-medium flex items-center gap-2 disabled:opacity-50"
            >
              <Mail size={14} /> {pwBusy ? 'Sending OTP...' : 'Send OTP to Email'}
            </button>
          </form>
        )}

        {pwStage === 'otp' && (
          <form onSubmit={submitChange} className="space-y-4">
            {otpHint && (
              <div className="bg-emerald-50 border border-emerald-200 rounded p-3 text-xs text-success-500 flex items-center gap-2">
                <Mail size={14} /> {otpHint} · expires in 10 minutes
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1 flex items-center gap-1">
                <KeyRound size={12} /> OTP (6 digits)
              </label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
                placeholder="••••••"
                className="w-48 border border-surface-border rounded px-3 py-2 text-lg font-mono tracking-widest text-center bg-surface-base focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-ink-secondary mb-1">New Password</label>
                <div className="relative">
                  <input
                    type={showNew ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={8}
                    className="w-full border border-surface-border rounded px-3 py-2 pr-10 text-sm bg-surface-base focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  <button type="button" onClick={() => setShowNew(!showNew)} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-subtle hover:text-ink-primary">
                    {showNew ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <p className="text-[10px] text-ink-muted mt-1">Minimum 8 characters</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-secondary mb-1">Confirm New Password</label>
                <input
                  type={showNew ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="w-full border border-surface-border rounded px-3 py-2 text-sm bg-surface-base focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                {confirmPassword && newPassword !== confirmPassword && (
                  <p className="text-[10px] text-danger-500 mt-1">Passwords do not match</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={pwBusy || otp.length !== 6 || !newPassword || newPassword !== confirmPassword}
                className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded text-sm font-medium flex items-center gap-2 disabled:opacity-50"
              >
                <Lock size={14} /> {pwBusy ? 'Updating...' : 'Update Password'}
              </button>
              <button
                type="button"
                onClick={cancelOtp}
                disabled={pwBusy}
                className="text-sm text-ink-secondary px-4 py-2 border border-surface-border rounded hover:bg-surface-muted disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
