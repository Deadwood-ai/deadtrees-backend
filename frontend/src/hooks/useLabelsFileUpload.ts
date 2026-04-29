import { useState } from "react";
import type { UploadFile, UploadProps } from "antd";

const useLabelsFileUpload = () => {
  const [labelsFileList, setLabelsFileList] = useState<UploadFile[]>([]);
  const onLabelsFileChange: UploadProps["onChange"] = ({ fileList: newFileList }) => {
    setLabelsFileList(newFileList.slice(-1));
  };

  const beforeLabelsUpload: UploadProps["beforeUpload"] = (file) => {
    setLabelsFileList([file]);
    return false;
  };

  return { labelsFileList, onLabelsFileChange, beforeLabelsUpload };
};

export default useLabelsFileUpload;
