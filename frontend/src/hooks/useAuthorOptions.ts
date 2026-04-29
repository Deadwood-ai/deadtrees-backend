import { useData } from "../hooks/useDataProvider";

interface AuthorOption {
  label: string;
  value: string;
}

export const useAuthorOptions = () => {
  const { authors } = useData();
  return (authors ?? []) as AuthorOption[];
};
