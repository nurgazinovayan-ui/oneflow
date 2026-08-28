import { createContext, useContext } from 'react';

export const ProjectIdContext = createContext<string>('');

export const useProjectId = () => useContext(ProjectIdContext);
