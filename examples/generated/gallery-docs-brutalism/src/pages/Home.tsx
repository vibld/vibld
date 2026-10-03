import SiteHeader from '@/components/SiteHeader';
import PageIntro from '@/components/PageIntro';
import InstallationSection from '@/components/InstallationSection';
import QuickStartSection from '@/components/QuickStartSection';
import CommandReferenceSection from '@/components/CommandReferenceSection';
import SiteFooter from '@/components/SiteFooter';

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main id='main'>
        <PageIntro />
        <InstallationSection />
        <QuickStartSection />
        <CommandReferenceSection />
      </main>
      <SiteFooter />
    </>
  );
}
