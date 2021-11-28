import React, { FormEvent, useEffect, useState, useRef } from "react";
import type { NextPage } from "next";
import Head from "next/head";
import GithubCorner from "react-github-corner";

import styles from "../styles/Home.module.scss";

function useStringStateWithLocalStorage(
  key: string
): [string | null, (value: string | null) => void] {
  const [value, setValue] = useState<string | null>(null);

  useEffect(() => {
    if (window.localStorage && value) {
      window.localStorage.setItem(key, value);
    }
  }, [value, key]);

  useEffect(() => {
    if (window.localStorage) {
      setValue(window.localStorage.getItem(key));
    }
  }, [key]);

  return [value, setValue];
}

function useBooleanStateWithLocalStorage(
  key: string,
  defaultValue: boolean
): [boolean, (value: boolean) => void] {
  const didMount = useRef(false);
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    if (window.localStorage && didMount.current) {
      window.localStorage.setItem(key, String(value));
    }
  }, [value, key]);

  useEffect(() => {
    if (window.localStorage) {
      const value = window.localStorage.getItem(key);
      if (!value) {
        return;
      }
      setValue(value === "true" ? true : false);
      didMount.current = true;
    }
  }, [key]);

  return [value, setValue];
}

const Home: NextPage = () => {
  const [ethAddress, setEthAddress] =
    useStringStateWithLocalStorage("ethAddress");

  return (
    <div className={styles.container}>
      <Head>
        <title>Dark Forest Helm</title>
        <meta name="description" content="Utilities for darkforest_eth" />
      </Head>

      <main className={styles.main}>
        <GithubCorner
          href="https://github.com/fravic/df-helm"
          bannerColor="white"
          octoColor="#192a42"
        />
        <header className={styles.header}>
          <h1 className={styles.title}>DF Helm</h1>
          <div className={styles.inputWithLabel}>
            <label className={styles.inputLabel}>Account Address</label>
            <input
              className={styles.addressInput}
              type="text"
              value={ethAddress || ""}
              onChange={(e) => setEthAddress(e.target.value)}
              placeholder="eg. 0x18388BDb9f56aAC7eA9fB4f55954799A041037f2"
            />
          </div>
        </header>

        <NotificationsSection ethAddress={ethAddress} />
      </main>

      <footer className={styles.footer}>fravic.eth</footer>
    </div>
  );
};

type CollapsibleSectionPropsType = {
  children: React.ReactNode;
  title: string;
  storageKey: string;
};

const CollapsibleSection = (props: CollapsibleSectionPropsType) => {
  const [isExpanded, setIsExpanded] = useBooleanStateWithLocalStorage(
    `section${props.storageKey}`,
    true
  );
  return (
    <div className={styles.collapsibleSection}>
      <div
        className={styles.collapsibleSectionHeader}
        style={{ borderBottom: !isExpanded ? "none" : "inherit" }}
      >
        {props.title}{" "}
        <button
          className="material-icons"
          onClick={() => {
            setIsExpanded(!isExpanded);
          }}
          style={{ transform: isExpanded ? "none" : "rotate(180deg)" }}
        >
          expand_more
        </button>
      </div>
      <div
        className={styles.collapsibleSectionBody}
        style={{ display: isExpanded ? "block" : "none" }}
      >
        {props.children}
      </div>
    </div>
  );
};

type NotificationsSectionPropsType = {
  ethAddress: string | null;
};

const NotificationsSection = (props: NotificationsSectionPropsType) => {
  const [iftttApiKey, setIftttApiKey] =
    useStringStateWithLocalStorage("iftttApiKey");
  const [success, setSuccess] = useState(false);

  const handleSubmitApiToken = async (e: FormEvent) => {
    e.preventDefault();

    const res = await fetch("/api/subscribeAddress", {
      body: JSON.stringify({
        ethAddress: props.ethAddress,
        iftttApiKey,
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    const result = await res.json();
    if (result.success) {
      setIftttApiKey(null);
      setSuccess(true);
    } else {
    }
  };

  return (
    <CollapsibleSection title="Notifications" storageKey="Notifications">
      <p style={{ marginBottom: "1.25rem" }}>
        Enter an{" "}
        <a href="https://ifttt.com" target="_blank" rel="noreferrer">
          IFTTT
        </a>{" "}
        webhook key to receive push notifications when your planets are
        attacked.
        <br />
        <a href={process.env.DOCS_URL} target="_blank" rel="noreferrer">
          How do I set this up?
        </a>
      </p>

      <form onSubmit={handleSubmitApiToken}>
        <div
          className={styles.inputWithLabel}
          style={{ maxWidth: "500px", marginBottom: "0.5rem" }}
        >
          <label className={styles.inputLabel}>IFTTT Webhook Key</label>
          <input
            type="text"
            value={iftttApiKey || ""}
            onChange={(e) => setIftttApiKey(e.target.value)}
            placeholder="a 21-character string"
          />
        </div>
        <div className={styles.formSubmitContainer}>
          <button onSubmit={handleSubmitApiToken} type="submit">
            Submit
          </button>

          {success && (
            <>
              <span className="material-icons">checkmark</span> Successfully
              subscribed to notifications
            </>
          )}
        </div>
      </form>
    </CollapsibleSection>
  );
};

export default Home;
