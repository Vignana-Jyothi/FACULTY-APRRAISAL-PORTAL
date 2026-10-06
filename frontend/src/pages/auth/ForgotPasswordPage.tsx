import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authApi } from '../../api/auth';
import toast from 'react-hot-toast';
import { GraduationCap, Mail, KeyRound, Lock, ArrowLeft, Eye, EyeOff } from 'lucide-react';

type Stage = 'request' | 'reset';

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>('request');
  const [employeeCode, setEmployeeCode] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const requestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeCode.trim()) return;
    setBusy(true);
    try {
      const r = await authApi.forgotPassword(employeeCode.trim());
      toast.success(r.message ?? 'If your account exists, an OTP has been emailed.');
      setStage('reset');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Request failed');
    } finally {
      setBusy(false);
    }
  };

  const submitReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
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
    setBusy(true);
    try {
      await authApi.resetPassword(employeeCode.trim(), otp, newPassword);
      toast.success('Password reset successful');
      navigate('/login');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Reset failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left pane — institute hero */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-primary-700 via-primary-800 to-primary-900 text-white flex-col items-center justify-center p-12 relative overflow-hidden">
        <div className="absolute -top-20 -left-20 w-64 h-64 rounded-full bg-accent-500/10" />
        <div className="absolute -bottom-32 -right-16 w-80 h-80 rounded-full bg-accent-500/5" />

        <div className="relative z-10 text-center max-w-md">
          {/* Institute logo (light card so the black wordmark reads on the dark hero) */}
          <div className="bg-white rounded-xl shadow-lg px-6 py-5 mb-8 inline-block">
            <img
              src="/vnrvjiet-logo.png"
              alt="VNRVJIET — Vallurupalli Nageswara Rao Vignana Jyothi Institute of Engineering & Technology"
              className="h-20 w-auto mx-auto"
            />
          </div>

          <p className="text-xs text-primary-300 italic font-serif mt-12">TAMASOMA JYOTIRGAMAYA</p>
          <p className="text-[10px] text-primary-400 mt-1">"Lead me from darkness to light"</p>
        </div>
      </div>

      {/* Right pane — reset form */}
      <div className="flex-1 flex items-center justify-center bg-surface-base p-6">
        <div className="w-full max-w-sm">
          <div className="lg:hidden text-center mb-8">
            <img src="/vnrvjiet-logo.png" alt="VNRVJIET" className="h-12 w-auto mx-auto mb-3" />
            <div className="text-xs text-ink-muted">Faculty Appraisal Portal</div>
          </div>

          <div className="bg-surface-card border border-surface-border rounded-md shadow-sm overflow-hidden">
            <div className="h-1 bg-accent-500" />

            <div className="p-6">
              <div className="flex items-center gap-2 mb-1">
                <GraduationCap size={20} className="text-primary-600" />
                <h2 className="text-lg font-bold text-ink-primary">Forgot Password</h2>
              </div>

              {stage === 'request' && (
                <form onSubmit={requestOtp} className="space-y-4 mt-4">
                  <p className="text-xs text-ink-muted">
                    Enter your employee code. We'll email a 6-digit OTP to your registered email if the account exists.
                  </p>

                  <div>
                    <label className="block text-xs font-medium text-ink-secondary mb-1">Employee Code</label>
                    <input
                      value={employeeCode}
                      onChange={(e) => setEmployeeCode(e.target.value.toUpperCase())}
                      required
                      autoCapitalize="characters"
                      placeholder="e.g. FAC001"
                      className="w-full border border-surface-border rounded px-3 py-2 text-sm bg-surface-base uppercase placeholder:normal-case focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={busy || !employeeCode.trim()}
                    className="w-full flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white font-medium py-2.5 px-4 rounded text-sm"
                  >
                    <Mail size={14} /> {busy ? 'Sending OTP...' : 'Send OTP to Email'}
                  </button>
                </form>
              )}

              {stage === 'reset' && (
                <form onSubmit={submitReset} className="space-y-4 mt-4">
                  <div className="bg-emerald-50 border border-emerald-200 rounded p-3 text-xs text-success-500 flex items-center gap-2">
                    <Mail size={14} /> OTP sent · expires in 10 minutes
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-ink-secondary mb-1 flex items-center gap-1">
                      <KeyRound size={11} /> OTP (6 digits)
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
                      className="w-full border border-surface-border rounded px-3 py-2 text-lg font-mono tracking-widest text-center bg-surface-base focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>

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

                  <button
                    type="submit"
                    disabled={busy || otp.length !== 6 || !newPassword || newPassword !== confirmPassword}
                    className="w-full flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white font-medium py-2.5 px-4 rounded text-sm"
                  >
                    <Lock size={14} /> {busy ? 'Resetting...' : 'Reset Password'}
                  </button>

                  <button
                    type="button"
                    onClick={() => { setStage('request'); setOtp(''); setNewPassword(''); setConfirmPassword(''); }}
                    className="w-full text-xs text-ink-muted hover:text-ink-primary mt-1"
                  >
                    Didn't get the OTP? Resend
                  </button>
                </form>
              )}

              <Link to="/login" className="flex items-center justify-center gap-1 text-xs text-ink-muted hover:text-primary-600 mt-5">
                <ArrowLeft size={12} /> Back to Login
              </Link>
            </div>
          </div>

          <p className="text-center text-[10px] text-ink-subtle mt-4">
            &copy; {new Date().getFullYear()} VNRVJIET — Faculty Appraisal System
          </p>
        </div>
      </div>
    </div>
  );
}
