import threading
from typing import List


class ChatVelocityChart:
    """
    Thread-safe manager for chat velocity/rate data storage for chart visualization.
    """

    def __init__(self, max_points: int = 200) -> None:
        """
        Initialize the chat velocity chart manager.

        Args:
            max_points: Maximum number of rate points to store (default: 200)
        """
        self._rates: List[float] = []
        self._lock = threading.Lock()
        self._max_points = max_points

    def add_rate(self, rate: float) -> None:
        """
        Add a new rate point to the chart data.
        Automatically limits the array size to prevent memory issues.

        Args:
            rate: Messages per second rate value
        """
        with self._lock:
            self._rates.append(rate)
            # Limit rates array to last max_points to prevent memory issues
            if len(self._rates) > self._max_points:
                self._rates = self._rates[-self._max_points :]

    def get_rates(self) -> List[float]:
        """
        Get a copy of the current rates array.
        Thread-safe.

        Returns:
            List of rate values (messages per second)
        """
        with self._lock:
            return list(self._rates)

    def clear(self) -> None:
        """
        Clear all stored rates.
        Thread-safe.
        """
        with self._lock:
            self._rates.clear()

    def count(self) -> int:
        """
        Get the number of stored rate points.
        Thread-safe.

        Returns:
            Number of rate points stored
        """
        with self._lock:
            return len(self._rates)

