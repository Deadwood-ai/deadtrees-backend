import { Alert, Button, Form, Input, message, Spin } from "antd";
import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";

import { useAuth } from "../../hooks/useAuthProvider";
import { supabase } from "../../hooks/useSupabase";

type ResetPasswordFormValues = {
  confirmPassword: string;
  password: string;
};

const MIN_PASSWORD_LENGTH = 6;

function getPasswordResetErrorMessage(error: unknown) {
  if (!error || typeof error !== "object" || !("message" in error)) {
    return "We could not update your password. Please request a new reset link and try again.";
  }

  const errorMessage = String((error as { message?: unknown }).message || "");
  const normalizedMessage = errorMessage.toLowerCase();

  if (normalizedMessage.includes("auth session missing") || normalizedMessage.includes("session")) {
    return "This reset link is missing or expired. Please request a new password reset email.";
  }

  if (normalizedMessage.includes("weak") || normalizedMessage.includes("password")) {
    return errorMessage;
  }

  return errorMessage || "We could not update your password. Please request a new reset link and try again.";
}

const ResetPassword = () => {
  const { status } = useAuth();
  const [form] = Form.useForm<ResetPasswordFormValues>();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();

  const onFormSubmit = async ({ password }: ResetPasswordFormValues) => {
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setErrorMessage(getPasswordResetErrorMessage(error));
        return;
      }

      form.resetFields();
      navigate("/profile");
      message.success("Password updated successfully");
    } catch (error) {
      setErrorMessage(getPasswordResetErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasRecoverySession = status === "authenticated";

  return (
    <div className="m-auto flex h-full max-w-7xl items-center justify-center">
      <div className="w-96 rounded-md bg-white p-8">
        <h1 className="mb-8 text-3xl font-semibold text-gray-600">Reset Password</h1>
        {status === "checking" ? (
          <div className="flex items-center justify-center gap-3 py-8 text-gray-600">
            <Spin />
            <span>Checking reset link...</span>
          </div>
        ) : null}
        {status === "anonymous" ? (
          <Alert
            className="mb-4"
            showIcon
            type="warning"
            message="Reset link expired"
            description={(
              <span>
                Request a new password reset email, then open the latest link from your inbox.{" "}
                <Link to="/forgot-password" className="text-blue-500 underline">
                  Send a new reset link
                </Link>
              </span>
            )}
          />
        ) : null}
        {errorMessage ? <Alert className="mb-4" showIcon type="error" message={errorMessage} /> : null}
        <Form form={form} layout="vertical" onFinish={onFormSubmit} disabled={!hasRecoverySession || isSubmitting}>
          <Form.Item
            label="New Password"
            name="password"
            rules={[
              { required: true, message: "Please enter a new password." },
              {
                min: MIN_PASSWORD_LENGTH,
                message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
              },
            ]}
          >
            <Input.Password className="w-full p-2" placeholder="New Password" autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            label="Confirm New Password"
            name="confirmPassword"
            dependencies={["password"]}
            rules={[
              { required: true, message: "Please confirm your new password." },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue("password") === value) {
                    return Promise.resolve();
                  }

                  return Promise.reject(new Error("Passwords do not match."));
                },
              }),
            ]}
          >
            <Input.Password className="w-full p-2" placeholder="Confirm New Password" autoComplete="new-password" />
          </Form.Item>
          <Form.Item>
            <Button
              className="w-full"
              disabled={!hasRecoverySession}
              loading={isSubmitting}
              size="large"
              type="primary"
              htmlType="submit"
            >
              Reset Password
            </Button>
          </Form.Item>
        </Form>
      </div>
    </div>
  );
};

export default ResetPassword;
