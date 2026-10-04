import Workspace from '../workspace';
import { localhostPreview, validProjectName } from '../project-url';
import { notFound } from 'next/navigation';

export default async function ProjectPage({ params, searchParams }: {
  params: Promise<{ projectname: string[] }>;
  searchParams: Promise<{ preview?: string | string[] }>;
}) {
  const { projectname: encodedParts } = await params;
  let projectname: string;
  try {
    projectname = encodedParts.map((part) => decodeURIComponent(part)).join("/");
  } catch {
    notFound();
  }
  if (!validProjectName(projectname)) notFound();
  const { preview } = await searchParams;
  let address = '';
  let error = '';
  if (preview !== undefined) {
    try {
      address = localhostPreview(typeof preview === 'string' ? preview : '');
    } catch {
      error = 'This preview address is invalid. Open settings and enter a localhost URL.';
    }
  }
  const demo = projectname === 'demo' && preview === undefined;
  return <Workspace name={projectname} preview={demo ? '/harness/demo/preview.html' : address} demo={demo} initialError={error} />;
}
